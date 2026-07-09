# Plan: server-side card search (RPC) + async pagination

Status: **spec** · Owner repos: `tcgscan-data` (the `search_cards` RPC + migration)
+ `tcgscan-browse` (async paginated search path) · Apps: `poke-michi`, `tcgscan-expo`

## Why

Today full-corpus search runs client-side: `runQuery(catalog.listAll(), …)` scans all
~28k cards. That's fast *once the catalog is in memory* — but it can't return anything
until the 5.8 MB catalog has downloaded, parsed, and built its 28k-object index (the
cold-start freeze). Moving search to the database returns a first page in ~80 ms
**without** the catalog loaded, and — crucially — **removes the main reason the client
must hold all 28k cards in memory**, which is the unlock for lazy-loading the catalog.

Search stays client-side as a fallback (static/offline) and, later, as the warm-path.

## Architecture

```
query string ──parseQuery()──▶ ParsedQuery ──▶ searchCards(parsed, page)
   (client, unchanged grammar)                    │  POST /rest/v1/rpc/search_cards
                                                   ▼
                                       search_cards() RPC  ─▶ page of tile rows + total
                                       (cards ⋈ price_latest)
```

- **Client parses** (keep `parseQuery`/`QUERY_MANUAL` as the single grammar source of
  truth) and sends *structured* params to the RPC. No grammar reimplemented in SQL.
- **RPC executes** filter + rank + page against Postgres, returns tile-ready rows so
  search doesn't depend on the in-memory catalog.
- **Fallback:** when `getApiUrl()` is empty (static mode), the kit uses the existing
  client-side `runQuery`. Nothing is removed.

## The RPC: `search_cards`

Must reproduce `scoreCard`/`runQuery` semantics exactly:

- **Bare words** (AND): each word scores `name LIKE 'w%'` → +5, else `name LIKE '%w%'`
  → +3, else `haystack LIKE '%w%'` → +1, else the row is rejected. Base score 1.
  Haystack = `name, illustrator, set_name, series, rarity, stage, number, types[],
  card_type[]` (matches `lowered().rest`).
- **Field filters** `key:value` (substring, lowercased), rejected if unmatched:
  `artist/illustrator`→illustrator, `rarity`→rarity, `set`→set_name, `series`→series,
  `type`→types ∪ card_type, `stage`→stage, `year`→left(release_date,4), `num`→number.
- **Price** from `price_latest.cur` (null → 0, matching `priceOf`): `>=min`, `<=max`.
- **Sort:** `relevance` = score desc; `value` = cur desc; `newest` = release_date desc;
  `name` = name asc. Always append `id` as the final tiebreaker (stable paging).

### Signature

```sql
create function search_cards(
  p_words      text[]  default '{}',
  p_fields     jsonb   default '[]',   -- [{"key":"rarity","value":"holo"}, …]
  p_min_price  numeric default null,
  p_max_price  numeric default null,
  p_sort       text    default 'relevance',
  p_limit      int     default 40,
  p_offset     int     default 0       -- Phase 1: offset paging (see cursor note)
) returns table (
  id text, name text, number text, rarity text, card_type text[],
  set_id bigint, illustrator text, types text[], stage text, jumbo bool,
  cur numeric, score int, total_count bigint
) language sql stable;
```

### Body sketch

```sql
with matched as (
  select c.id, c.name, c.number, c.rarity, c.card_type, c.set_id,
         c.illustrator, c.types, c.stage, c.jumbo,
         coalesce(pl.cur, 0) as cur,
         (1 + (select coalesce(sum(case
                 when lower(c.name) like w||'%'        then 5
                 when lower(c.name) like '%'||w||'%'   then 3
                 when c.search_text like '%'||w||'%'   then 1 else 0 end),0)
               from unnest(p_words) w))::int as score
  from cards c
  left join price_latest pl on pl.product_id = c.id
  where (select bool_and(c.search_text like '%'||w||'%') from unnest(p_words) w)   -- AND words
    and (select bool_and(                                                          -- AND fields
          case f->>'key'
            when 'rarity' then lower(c.rarity) like '%'||(f->>'value')||'%'
            when 'set'    then lower(c.set_name) like '%'||(f->>'value')||'%'
            when 'series' then lower(c.series) like '%'||(f->>'value')||'%'
            when 'artist' then lower(c.illustrator) like '%'||(f->>'value')||'%'
            when 'stage'  then lower(c.stage) like '%'||(f->>'value')||'%'
            when 'num'    then lower(c.number) like '%'||(f->>'value')||'%'
            when 'year'   then left(c.release_date::text,4) like '%'||(f->>'value')||'%'
            when 'type'   then exists (select 1 from unnest(c.types||c.card_type) t
                                       where lower(t) like '%'||(f->>'value')||'%')
            else true end
        ) from jsonb_array_elements(p_fields) f)
    and (p_min_price is null or coalesce(pl.cur,0) >= p_min_price)
    and (p_max_price is null or coalesce(pl.cur,0) <= p_max_price)
)
select *, count(*) over() as total_count
from matched
order by case when p_sort='relevance' then score end desc nulls last,
         case when p_sort='value'     then cur   end desc nulls last,
         case when p_sort='newest'    then release_date end desc nulls last,
         case when p_sort='name'      then name  end asc  nulls last,
         id
limit p_limit offset p_offset;
```

- `search_text` is a **generated column** on `cards`:
  `lower(name||' '||coalesce(illustrator,'')||' '||coalesce(set_name,'')||' '||…)`.
- `total_count` (window) gives the real "N results" for `describeQuery` on every page.

### Indexes / migration (tcgscan-data)

- `create extension if not exists pg_trgm;`
- generated `cards.search_text` + `create index … using gin (search_text gin_trgm_ops);`
- btree: `price_latest(product_id, cur)`, `cards(release_date)`, `cards(rarity)`, and
  trigram on `name` for the prefix/contains ranking probes.
- `grant execute on function search_cards … to anon;` (cards are public-read).

No pipeline change: `publish_catalog` already upserts every column the RPC reads.

### Pagination: offset now, keyset later

Phase 1 uses `limit/offset` — simplest, and search sets are small (cap total, e.g.
500). The `id` tiebreaker keeps pages stable. Phase 2 swaps to **keyset** (pass the last
row's `(sort_key, id)` tuple) for O(1) deep paging if needed.

## Kit changes (tcgscan-browse)

1. **`searchCards(parsed, { limit, offset })`** (new `search.ts`): POST to
   `rpc/search_cards`, return `{ hits: SearchHit[], total }`. `SearchHit` is the tile
   shape (id/name/rarity/setId/cur/…) — enough to render a `CardTile` and open the
   action sheet without the card being in the in-memory catalog.
2. **`CatalogBrowser` search path becomes async + paginated** when `getApiUrl()` is set:
   - state: `hits`, `total`, `loading`, `page`, `hasMore`; accumulate pages.
   - `onChangeQuery` (debounced 250 ms) resets to page 0 and refetches.
   - `FlatList onEndReached` → next page (append).
   - **Race guard:** a monotonically increasing request token; ignore stale responses.
   - `describeQuery` uses `total`; the "N results" header shows the real count.
   - When `apiUrl` is empty → the current `runQuery(listAll())` path (unchanged).
3. **Tile/sheet rendering from `SearchHit`.** `CardTile` already resolves images via
   `cardThumbUrl(id, …)`, so a hit needs no catalog lookup to render. The action sheet's
   built-ins (`viewSet`) use `set_id` from the hit; `findSimilar` uses `id`.

## Facets in search mode — the one real tradeoff

The facet bar assumes the whole result set is client-side (it enumerates distinct
values + counts over `viewCards`). With paginated server search that set isn't local.

- **Selection still works for free** — a facet chip is just a field filter; toggling it
  re-runs `search_cards` with an added `p_fields` entry.
- **Enumeration/counts don't** — that needs a second `search_facets(...)` RPC returning
  distinct values + counts for the predicate.
- **Phase 1:** hide the facet chip row in server-search mode (drill-down levels keep it,
  since those are already in memory). **Phase 2:** add `search_facets` to restore it.

## Rollout / back-compat

Additive and reversible:
1. **tcgscan-data** — migration (generated column + indexes + `search_cards`, `search_facets`).
2. **tcgscan-browse** — async paginated search behind `getApiUrl()`; client `runQuery`
   retained as the static/offline fallback. Version bump.
3. **Apps** — bump; `CatalogBrowser` already receives `apiUrl` via `configureBrowse`, so
   no app code change beyond the bump (both already pass `EXPO_PUBLIC_CATALOG_API_URL`).

The grammar (`parseQuery`, `QUERY_MANUAL`) is untouched and stays the single source of
truth. `runQuery`/`scoreCard` stay exported (fallback + tests).

## Phasing

- **P1** — RPC + async paginated server search (offset, total_count, facets hidden in
  search). Delivers instant first-page search decoupled from catalog load.
- **P2** — `search_facets` RPC (restore facet bar in search); keyset paging.
- **P3** — hybrid warm-path: prefer client `runQuery` once the catalog is fully loaded
  (zero-latency refinement, offline), server RPC while cold.
- **P4** — with search off the client, drop the full-corpus in-memory requirement →
  lazy-load the catalog (taxonomy + per-set on drill-down), collapsing the 250 MB /
  1-min cold start. (See the lazy-load discussion; server search is its prerequisite.)

## Related consumer: the `RecentProducts` feed (P4 dependency)

`RecentProducts` (v0.4.0+) is wired at the top of poke-michi's home screen and needs
`catalog.allSets()` + a few `listCards(setId)` per set — so it currently **forces the
full `catalog.json` load on home**, the exact cold-start cost P4 aims to remove. It only
needs set-level rows plus the chase cards for ~a handful of recent/upcoming sets, so it's
a natural client of a lightweight endpoint:

- a `recent_sets` view/RPC (sets ⋈ their top-N cards by value, filtered to the last N
  months + future-dated) would let the feed render **without** the in-memory catalog, and
- pairs with the async `getCardDetail(id)` from P4's open question below.

Until then the feed loads the catalog in the background (covers paint first). Fold this
into P4 so the home screen goes back to catalog-free.

## Open questions

- **`getCard` for binders** (poke-michi) still needs random-access to any card by id —
  the *other* in-memory anchor. Lazy-load (P4) must pair server search with an async
  `getCardDetail(id)` (PostgREST `cards?id=eq.…`) for binder/collection resolution.
- **Fuzzy matching:** trigram enables `%>` similarity ranking later (typo tolerance) —
  out of scope for parity, but the index supports it.
