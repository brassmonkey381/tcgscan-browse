# tcgscan-browse

The shared Pokemon TCG **card-browse kit** for the TCGScan apps (michi-maker,
tcgscan-app): clients for the `tcgscan-data` server (catalog / taxonomy /
prices / sealed / server search / embedding + color similarity), the search-box
**query grammar** (+ its "?" manual content), and the **CatalogBrowser** React
Native component with its action sheet, analytics, and feed surfaces.

Extracted from poke-michi so the two apps stop maintaining parallel copies —
one component, both apps, app-specific actions injected via props. The kit is a
**pure, read-only consumer** of tcgscan-data: it never writes to the data
project, and it holds no app-specific or per-user code (collections, binders,
auth — those stay in the apps and get injected, e.g. `ownedIds`).

## Install (consumers)

```jsonc
// package.json
"dependencies": { "tcgscan-browse": "github:brassmonkey381/tcgscan-browse" }
```

`dist/` is committed, so installs need no build step. To pick up a new version,
bump/reinstall the dep (`npm update tcgscan-browse`) and restart Metro with
`-c` so the bundler drops the stale copy.

## Release workflow (maintainers)

CI-less by design; the consumers import `dist/`. To cut a version:

1. Edit `src/`, keep `npm run check` (tsc --noEmit) clean.
2. **`npm run build`** — regenerates `dist/` (js + d.ts). Never hand-edit `dist/`.
3. Bump `version` in `package.json`.
4. Commit **src + dist + package.json together** — the convention is one commit
   per release, message `feat(scope): vX.Y.Z — summary` (no git tags, no npm
   publish; the GitHub repo *is* the registry).
5. Push `main`, then bump the dep in both consumers (poke-michi, tcgscan-expo).

Because both apps consume `main` via the git dependency, **any exported-API
change is a breaking change for two apps at once** — keep changes additive
(new optional props, back-compat defaults) or coordinate the bump.

## Wire-up (once, in app code)

Expo inlines `EXPO_PUBLIC_*` env only in app source — node_modules code can't
read it. So each app keeps a tiny config shim:

```ts
// src/lib/catalogConfig.ts (app shim)
import { configureBrowse } from 'tcgscan-browse';

configureBrowse({
  browseUrl: process.env.EXPO_PUBLIC_CATALOG_BROWSE_URL ?? '/browse',
  imgBase: process.env.EXPO_PUBLIC_CATALOG_IMG_BASE ?? '',
  apiKey: process.env.EXPO_PUBLIC_CATALOG_API_KEY ?? '',
  // optional: apiUrl (derived from browseUrl's origin when omitted),
  // cache (AsyncStorage adapter for the image manifest),
  // catalogSource (gated/encrypted catalog loader — see docs/DATA-PROTECTION-PLAN.md),
  // colorUrl (on-device color blobs; defaults to `${browseUrl}/color`)
});

export * from 'tcgscan-browse'; // apps import the kit through their shim
```

Then anywhere:

```tsx
import { CatalogBrowser, loadCatalog, usePriceSummary, findSimilar } from 'tcgscan-browse';
```

## Warm and cold modes

`CatalogBrowser` runs against two data paths and the consumer just passes
`catalog` through from its loader:

- **Warm** — the in-memory catalog is loaded: on-device search (`runQuery`),
  facets, drill-down, everything local.
- **Cold** — `catalog` is null/undefined but `apiUrl`/`apiKey` are configured:
  text search hits the `search_cards` RPC (with `search_facets` for the chip
  bar), the drill-down walks the tiny public `taxonomy.json` and fetches each
  set's cards from PostgREST on drill, and ids resolve via `fetchCardsByIds`.
  Server search reproduces the client grammar semantics exactly, so warm and
  cold return the same results in the same order.

## What lives here vs. in the apps

See **`docs/ARCHITECTURE.md`** for the full three-layer breakdown (datasource /
kit / app), the seams between them, and the grammar-sync checklist. Quick
table:

| Here (shared) | In each app |
|---|---|
| Catalog types + loader (load-once, subscribe, prefetch, chunked build) | View-model adapters (michi's `catalogCardToDemoCard`) |
| Cold-mode clients: `searchCards` / `searchFacets` / `fetchSetCards` / `fetchCardsByIds` / `fetchCardDetail` + the public `taxonomy.json` loader | — |
| Price summary client + `formatUsd` + sealed-products client | Aggregations (michi's binder/page totals) |
| `find_similar` RPC client (+ weighted/Rocchio refine) and the color-similarity client (server RPCs + warm on-device index) | The color-picker UI that feeds `sendBrowseCommand({type:'showCards'})` |
| Query grammar + `QUERY_MANUAL` + `describeQuery` (incl. the `have:` collection predicate) | The `ownedIds` set the predicate evaluates against |
| `CatalogBrowser` + `CardActionModal` + `RecentProducts` + session browse state + browse commands + saved searches + web share-links (`?browse=`) + `BrowseTheme` + the S/M/L card-size norms | The `cardActions`/`quickAction` passed in (place, add-to-collection, quick-place…) + the app's `theme` override |
| Value analytics (`SetAnalytics`/`SeriesAnalytics`/`PriceChart`) | Where they navigate (`onOpenCard`) |
| Image-manifest resolution (`cardThumbUrl` by id) + URL derivations (`productUrl`, `setShopUrl`) | The persistent `cache` adapter injected via config |

**Keep the grammar and `QUERY_MANUAL` in sync** when new enrichment fields land
in the catalog (see the tcgscan-data pipeline): `QueryableCard`, `fieldValues()`,
`WORD_FIELDS`, and `QUERY_MANUAL` update together — and the server's
`search_cards` RPC must mirror the same semantics (see
`docs/SERVER-SEARCH-PLAN.md`).

## Status

- Consumed by **poke-michi** (michi-maker) and **tcgscan-expo** (the Expo app
  under `tcgscan-app/tcgscan-expo`). Current version: **v0.5.44** (2026-07-21).
- Recent releases:
  - **v0.5.44** — `builtins.viewIllustrator` artist action + collection-aware
    browse: `ownedIds` prop, `have:yes`/`have:no` query predicate, owned-check
    tile overlay, set/series completion ("X / Y · N%") and a Collection chip.
  - **v0.5.43** — lazy evolution detail: `fetchCardDetail` via `rpc/card_detail`
    (evolution fields dropped from the slim catalog, fetched on sheet open).
  - **v0.5.42** — saved searches (star-a-search chips), web share links
    (`?browse=` URL state), price tags on tiles, web arrow-key/Enter/Esc grid
    navigation, Color chip.
  - **v0.5.35–41** — EN+JP language support (`languages` prop, schema-2 image
    manifest, JP shop links), color similarity (`searchByColors`, Tri-Color
    Search button), S/M/L card-size norms, `showCards` browse command.

## Docs

- `docs/ARCHITECTURE.md` — the three layers, the seams, the grammar-sync checklist. Start here.
- `docs/SERVER-SEARCH-PLAN.md` — the `search_cards`/`search_facets` RPC contract + cold mode (shipped).
- `docs/DATA-PROTECTION-PLAN.md` — the gated/encrypted catalog + `catalogSource` seam (P1/P3 shipped).
- `docs/GUEST-VS-SIGNIN-AUDIT.md` — guest (cold) vs signed-in (warm) parity audit.
- `docs/ACTION-SHEET-PLAN.md`, `docs/BROWSE-FEATURES-PLAN.md`, `docs/CATALOG-NORMALIZE-PLAN.md`, `docs/JUMBO-VUNION-SPEC.md` — shipped plans, kept as history/reference.
