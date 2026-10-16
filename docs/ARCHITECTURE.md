# Architecture: the three layers and the seams between them

Status: **reference** · Owner repo: `tcgscan-browse` · Consumers: `tcgscan-app`,
`poke-michi` · Datasource: `tcgscan-data` (Supabase buckets + PostgREST)

This doc draws the lines between the three things that meet in a browse screen:
the **datasource** that holds truth about cards, the **browse kit** (this repo)
that turns that truth into a browse experience, and the **downstream app** that
decides which datasource to point at and what a tap actually *does*.

## The governing principle

Draw each line by asking **"what changes together, and for what reason?"**

- The **datasource** changes when the *Pokémon data* changes — new sets drop,
  prices update, enrichment fields get added.
- The **browse kit** changes when the *way you browse* changes — new query
  operators, a new grid layout, a new analytics chart.
- The **app** changes when *what you do with a card* changes — place it in a
  binder, add it to a collection, navigate somewhere.

If a change forces edits in two layers, that's a **seam**. The goal is to make
the seams explicit, narrow, and few (there are four; see below). If a change
forces edits in *three* layers, you've found the one leaky boundary — the query
grammar — and it's called out at the end.

---

## Layer 1 — The datasource (`tcgscan-data`)

**Owns truth about cards. Knows nothing about React or how anyone browses.**

Lives here:

- The **wire artifacts**: `catalog.json` (now gated/encrypted — see
  `DATA-PROTECTION-PLAN.md`), the public `taxonomy.json`, `prices-summary.json`
  (+ the sealed variant), `sealed.json`, the image manifest (`images.json`),
  the color blobs — snake_case, denormalized for transport.
- The **image buckets** (`card-imgs` / `card-thumbs`, content-hashed) and the
  id→hash manifest.
- **Server-side compute** the client shouldn't do: the `find_similar` /
  `find_similar_weighted` embedding RPCs, the color-similarity RPCs,
  precomputed set/series value-over-time series (the v0.3.4 fan-out fix), the
  server search RPCs `search_cards` / `search_facets` (see
  `SERVER-SEARCH-PLAN.md`), the per-card `card_detail` RPC (lazy evolution
  fields), and a secondary game's theme search: `theme_search` /
  `theme_facets` over the private `card_themes` table, switched per game by
  the public `theme_search_games` registry (migrations 78/79; see "The
  secondary-game theme path" below).
- The **enrichment pipeline** that produces fields like `illustrator`, `types`,
  `stage`.

**Test:** could a non-React consumer (a CLI, a different app, a cron job) want
this exact byte stream? If yes, it's datasource.

---

## Layer 2 — The browse kit (`tcgscan-browse`, this repo)

**Owns the domain model + the browse experience. Datasource-shape on one side,
app-behavior on the other — the only layer that touches both.**

Lives here:

- **Data-access clients** that hide the wire format: `loadCatalog`,
  `getPriceSummary`, `findSimilar` — and the COLD-mode clients (`searchCards`,
  `searchFacets`, `fetchSetCards`, `fetchCardsByIds`, `fetchCardDetail`,
  `loadTaxonomy`) that browse without the catalog in memory, plus a secondary
  game's `searchThemes` / `themeFacets` / `mergeThemeHits`. Load-once,
  promise-cached, subscribe, degrade-to-empty. The app never calls `fetch` for
  card data.
- **The normalization boundary** — `RawCard` (snake_case wire) → `CatalogCard`
  (camelCase domain). *All* data-shape knowledge lives in `catalog.ts`. This is
  the single most important line in the system: the firewall that keeps a
  pipeline schema change from rippling into either app.
- **The query grammar**: `parseQuery` / `matchCard` / `QUERY_MANUAL`. The
  "language" of browsing is intrinsic to the kit.
- **The UI**: `CatalogBrowser`, `CardActionModal`, the analytics charts, session
  `browseState`, `BrowseTheme` (default light).
- **Pure derivations** that are functions of stable ids: `productUrl(id)`,
  `cdnImageUrl(id)`, `cardThumbUrl`. These *replace* fat per-card fields the
  datasource used to ship — the kit absorbing responsibility to slim the wire.

**Test:** does every consuming app want this identically? If yes, kit.
`formatUsd` is here; michi's per-page binder totals are not.

---

## Layer 3 — The app (`poke-michi` / `tcgscan-expo`)

**Owns identity, environment, and verbs. Knows nothing about wire formats or
normalization.**

Lives here:

- **Config/env injection** — the `catalogConfig.ts` shim calling
  `configureBrowse(...)`. This exists *only* because Expo inlines
  `EXPO_PUBLIC_*` in app source but not in `node_modules`. The app is the layer
  that knows which datasource origin, which API key, which cache adapter.
- **The verbs**: the `cardActions` factory — michi's "Place / Replace in
  pocket", tcgscan-app's "Add to collection / Details." The kit renders a dumb
  list; the app supplies the meaning.
- **Navigation**: `onOpenCard` / where "View set" goes.
- **View-model adapters**: michi's `catalogCardToDemoCard`.
- **App-specific aggregations**: binder/page value totals.
- **Persistence** of anything that outlives a session (the kit's `browseState`
  is deliberately module-level and non-persisted).

**Test:** would this be wrong or nonsensical in the other app? If yes, app.

---

## The four seams (intentional, necessary overlap)

These are the only places two layers touch. Keep them narrow and the system
stays maintainable.

| Seam | Between | Mechanism | The coupling |
|---|---|---|---|
| **1. Config injection** | app → kit → datasource | `configureBrowse({browseUrl, imgBase, apiUrl, apiKey, cache, catalogSource, colorUrl})` | App owns env (and, via `catalogSource`, auth + decryption of the gated catalog); kit owns lazy reads; datasource owns the origins. One function, called once. |
| **2. Normalization** | datasource → kit | `Raw*` types + `catalog.ts` mappers | The *only* place snake_case wire shape is known. A pipeline field rename dies here instead of spreading. |
| **3. Action factory** | app → kit | `cardActions(card, builtins)` + `BrowserBuiltins` | App supplies verbs; kit supplies the verbs it *must* own (`findSimilar`, `moreLikeThis`/`lessLikeThis`, `viewSet`, `viewIllustrator`) because they drive kit state / the data server. App composes `[...appActions, builtins.findSimilar, …]`. |
| **4. Theme injection** | app → kit | `BrowseTheme` prop (default `lightTheme`) | Kit ships a working default; app overrides tokens without forking components. |

---

## The seam that spans all three layers — watch it

The query grammar is the leakiest boundary. When the pipeline adds an enrichment
field, four things must move together, and they live in two different repos:

> `QueryableCard` + `fieldValues()` + `WORD_FIELDS` + `QUERY_MANUAL` (kit)
> ← must stay in sync with →
> the enrichment fields the pipeline emits (datasource).

This is inherent — a searchable field is meaningless unless both the producer
and the grammar agree it exists — but it's the root of the jumbo/vunion
pipeline↔kit mismatch. Treat it with a checklist rather than trusting memory.

**Grammar-sync checklist — when a new catalog field becomes searchable:**

1. Pipeline emits the field in `catalog.json` (datasource).
2. `RawCard` gains the raw field; the `catalog.ts` mapper normalizes it
   (normalization seam).
3. `QueryableCard` gains the domain field.
4. `fieldValues()` exposes it for facet/value enumeration.
5. `WORD_FIELDS` lists it if bare words should match it.
6. `QUERY_MANUAL` documents it (the search box "?" content).
7. The `search_cards` RPC (tcgscan-data) mirrors the new semantics, so the
   cold/server path stays at exact parity with the warm/on-device path.
8. If the change touches a bare word's haystack (`lowered()` in `query.ts`),
   tcgscan-data's `theme_publish.search_text()` changes with it (see the theme
   path's rules below).
9. Rebuild (`npm run build`) so `dist/` reflects the change before commit.

**Theme grammar (artwork namespaces) is a second list to keep in sync.** A new
artwork namespace (`ART_NAMESPACES` in `query.ts`, e.g. `character:` in v0.9.28
for the Lorcana / One Piece identity tags) needs its `QUERY_MANUAL` row, and the
server must match it as a qualified token in BOTH places that read theme fields:
`search_cards` (Pokémon) and `_theme_where` (every secondary game,
tcgscan-data migration 79).

**Exception — `lang:` does NOT have a `search_cards` case, deliberately.** A
language term is a hard filter over the whole corpus, which is exactly what the
RPC's `p_lang` argument already is. So `search.ts` (`foldLanguageTerms`) lifts
any `lang:` field out of `p_fields` and merges it into `p_lang` instead, and
`fieldValues(card, 'lang')` reaches the same answer warm. Parity holds without a
second grammar living in SQL. Two consequences worth knowing:

- Value synonyms (`jp`, `japanese`, `eng`, …) are resolved to the raw `en`/`ja`
  code **in `parseQuery`**, so the server only ever compares exact codes. Add new
  synonyms to `LANG_ALIASES` in `query.ts`, never to SQL.
- A `lang:` term INTERSECTS the active bound (the EN/JP toggle and the Language
  facet chip) like any other AND-ed term. An empty intersection is passed to the
  clients as `[]` and short-circuits to no results — it must never be collapsed
  to `undefined`, which the RPCs read as *unconstrained*.

**The language bound itself spans more than search.** `p_lang` also exists on
the similarity and colour RPCs (tcgscan-data migration 33). Anything that ranks
a top-N over the corpus must take the bound as an ARGUMENT, not filter the
result — a post-filtered top-24 rendered ~13 cards, because 46.7% of an EN
card's nearest neighbours are JP printings.

---

## The secondary-game theme path (v0.9.28)

Lorcana and One Piece browse their own public `catalog.json` warm, on the
device, like Pokémon. What they cannot do on the device is a themed query: their
bundles carry no captions or tags, and never will — tags, captions, scene scores
and full-art probabilities stay in tcgscan-data's private `card_themes` table.
So a host passes `themeServer={{ game, typeLabel, typeGroups, tools }}` to
`CatalogBrowser`, and a query with a theme field splits in two:

1. **Server half — ranking.** `searchThemes(game, { themes, words, frame,
   types, group })` posts to `rpc/theme_search` (or, for a caller the host
   vouches for, to the host's proxy with the body tagged
   `rpc: 'theme_search'`). It answers ids in rank order with public rank facts
   only (`art_band`, `full_art`, `type_group`, `total_count`) — never a tag.
   `themeFacets` gives the toolbar's chip counts (always direct, never clamped).
2. **Device half — everything else.** `mergeThemeHits` maps the ids onto the
   game's own catalog rows in server order (an id the bundle lacks is dropped);
   then `filterCards(rows, withoutTheme(parsed))` and `sortCards` apply
   rarity/set/price/have/comparisons/facets/sort exactly as on a warm Pokémon
   search.

The browser never calls `search_cards` / `search_facets` for a `themeServer`
game, and the failure Retry re-asks `theme_search`; there is no fallback to the
Pokémon RPCs. Relevance with nothing device-only pages lazily (300 ids a call);
a sort or any device-only filter drains every hit first (1000 a call), and
nothing renders from a partial drain. A free (clamped) caller gets the top N by
rank and the meter, and the browser groups those N by the registry's order
itself (the server ignores `p_group` for a clamped call). Without `themeServer`
nothing here runs: Pokémon's requests are byte-identical to v0.9.27's
(`scripts/theme-server-check.mjs` pins them).

Which games are served, their chip label and colours, and the kill switch live
in the public `theme_search_games` registry, so going live or off is a row
update in tcgscan-data, not a kit release.

**Two rules that span the repos — both are silent-drift bugs if missed:**

- **Any theme grammar change updates `_theme_where` AND `search_cards`.** They
  are the two SQL readers of a theme field (secondary games and Pokémon); a
  namespace, negation or matching rule added to one and not the other makes the
  same query mean different things per game.
- **Any change to `lowered()` updates `theme_publish.search_text()`.** A bare
  word in a theme query is matched on the server against `card_themes.search_text`,
  which tcgscan-data's publisher builds as an exact copy of the kit's bare-word
  haystack (`lowered()` in `query.ts`). If they drift, the meter and the server's
  word filter disagree with what the same word finds warm.

---

## The rule of thumb, compressed

- **Bytes about cards** → datasource.
- **Turning those bytes into a browse experience every app shares** → kit.
- **Deciding which datasource, and what a tap *does*** → app.
- **When two layers must agree, force it through one named function or one types
  file** — never let a second copy of the knowledge exist.
