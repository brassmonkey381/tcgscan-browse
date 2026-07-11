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

> **Grammar has grown since this doc's first draft** (kit v0.5.11–v0.5.14). The RPC must
> now reproduce the FULL current `src/query.ts`: hp/stage/date comparisons, sort
> **direction**, the entity/container split with **name-word suppression**, and the new
> sort fields. A ready-to-review migration lives at
> `tcgscan-data/supabase/migrations/20260710_12_search_cards.sql` (**draft, not applied**).

Must reproduce `scoreCard`/`runQuery`/`sortCards` semantics exactly:

- **Bare words** (AND): each word scores `starts_with(name,w)` → +5, else `name contains w`
  → +3, else an **entity** field contains w → +1, else a **container** field contains w AND
  w is not a "name-word" → +1, else the row is rejected. Base score 1.
  - **entity** = illustrator, rarity, stage, number, types[], card_type[] (the card's own identity).
  - **container** = set_name, series.
  - **name-word suppression** (`classifyNameWords`): a word that matches **≥ 3 card names** is
    "really a name" → its container (set/series) matches DON'T count. Keeps "pikachu" from
    dragging in every card of a "Pikachu"-named set, while "jungle"/"sword" still find sets.
    In SQL: a per-word `select count(*) from cards where name contains w >= 3` CTE.
- **Field filters** `key:value` (substring, lowercased), rejected if unmatched:
  `artist/illustrator`→illustrator, `rarity`→rarity, `set`→set_name, `series`→series,
  `type`→types ∪ card_type, `stage`→stage (string), `year`→left(release_date,4), `num`→number.
- **Comparisons** (AND; unknown value never matches): `hp <op> N`; `stage <op> N` (1-indexed =
  `evolution_stage_index + 1`); `date <op> PREFIX` where the client sends a normalized
  `yyyy[-mm[-dd]]` prefix and `>`/`>=` mean "in or after" (lexical compare on `release_date::text`;
  `<=` uses a `chr(65535)` upper sentinel, matching the client). op ∈ `> >= < <= =`.
- **Price** from `price_latest.cur` (null → 0, matching `priceOf`): `>=min`, `<=max`.
- **Sort field + direction:** `relevance` = score desc (dir ignored); `value`/`date`/`name`/`hp`/
  `stage` each honor `asc`/`desc`; unknown keys (null hp/date/stage-idx) sink **last regardless of
  direction**. Final tiebreaker: `id`.
  - **Parity note:** the client's `relevance` sort currently breaks ties by input order, the RPC by
    `id`. P1 aligns them by tiebreaking the client relevance sort on `id` too, so warm == cold.

### Signature (current — see the draft migration for the full body)

```sql
create function search_cards(
  p_words      text[]  default '{}',
  p_fields     jsonb   default '[]',   -- [{"key":"rarity","value":"holo"}, …]
  p_compares   jsonb   default '[]',   -- [{"field":"hp","op":">","value":"200"}, …]
  p_min_price  numeric default null,
  p_max_price  numeric default null,
  p_sort       text    default 'relevance',
  p_dir        text    default 'desc',
  p_limit      int     default 60,
  p_offset     int     default 0       -- Phase 1: offset paging (see cursor note)
) returns table (
  id text, name text, number text, rarity text, card_type text[],
  set_id integer, set_name text, series text, release_date date,
  illustrator text, types text[], stage text, hp integer,
  evolution_stage_index integer, evolves_from text, evolution_line text[],
  jumbo boolean, cur numeric, score integer, total_count bigint
) language sql stable;
```

Return cols carry enough to render a `CardTile` AND fill the action sheet (incl. the
evolves-from/to bits) without the card being in the in-memory catalog.

### Indexes / perf

A generated `cards.search_text` (lower name+entity+container) with a **trigram GIN** index
prefilters candidates to rows containing every word — a superset (container-only hits for
name-words are dropped by the exact scoring), so only the survivors get scored, not all ~28k
rows. Plus btree on `release_date`, `hp`, `evolution_stage_index`, `price_latest(product_id,cur)`,
and a trigram GIN on `lower(name)` for the name-word count probe.

### Body

The full, current body — words + name-word suppression + fields + hp/stage/date comparisons +
directional sort + `total_count` window — lives in the draft migration
`tcgscan-data/supabase/migrations/20260710_12_search_cards.sql`. Key structure:
`words` CTE (per-word `is_name_word`) → `candidates` (trigram prefilter) → `scored`
(exact per-word tiers + `words_ok`) → `filtered` (fields/compares/price) → directional order-by.

- `search_text` is a **generated column** on `cards` (`lower(name+entity+container)`).
- `total_count` (window) gives the real "N results" for `describeQuery` on every page.
- `starts_with(name,w)` / `position(w in …)` mirror JS `startsWith`/`includes` (literal, no LIKE
  wildcard surprises); field/compare CASE arms are `coalesce(…, false)` so a null never leaks a
  match. No pipeline change: `publish_catalog` already upserts every column the RPC reads.

### Indexes / migration (tcgscan-data)

In the draft migration: `pg_trgm`; generated `cards.search_text` + `gin (search_text gin_trgm_ops)`;
`gin (lower(name) gin_trgm_ops)` (name-word probe); btree on `release_date`, `hp`,
`evolution_stage_index`, `price_latest(product_id, cur)`; `grant execute … to anon, authenticated`.

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
