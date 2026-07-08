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

- The **wire artifacts**: `catalog.json`, `prices-summary.json`, the image
  manifest, `alternates.json` — snake_case, denormalized for transport.
- The **image buckets** (`card-imgs` / `card-thumbs`, content-hashed) and the
  id→hash manifest.
- **Server-side compute** the client shouldn't do: the `find_similar` embedding
  RPC, precomputed set/series value-over-time series (the v0.3.4 fan-out fix),
  and the server search RPC (see `SERVER-SEARCH-PLAN.md`).
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
  `getPriceSummary`, `findSimilar`. Load-once, promise-cached, subscribe,
  degrade-to-empty. The app never calls `fetch` for card data.
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
| **1. Config injection** | app → kit → datasource | `configureBrowse({browseUrl, imgBase, apiUrl, apiKey, cache})` | App owns env; kit owns lazy reads; datasource owns the origins. One function, called once. |
| **2. Normalization** | datasource → kit | `Raw*` types + `catalog.ts` mappers | The *only* place snake_case wire shape is known. A pipeline field rename dies here instead of spreading. |
| **3. Action factory** | app → kit | `cardActions(card, builtins)` + `BrowserBuiltins` | App supplies verbs; kit supplies the two verbs it *must* own (`findSimilar`, `viewSet`) because they drive kit state / the data server. App composes `[...appActions, builtins.findSimilar]`. |
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
7. Rebuild (`npm run build`) so `dist/` reflects the change before commit.

---

## The rule of thumb, compressed

- **Bytes about cards** → datasource.
- **Turning those bytes into a browse experience every app shares** → kit.
- **Deciding which datasource, and what a tap *does*** → app.
- **When two layers must agree, force it through one named function or one types
  file** — never let a second copy of the knowledge exist.
