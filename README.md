# tcgscan-browse

The shared Pokemon TCG **card-browse kit** for the TCGScan apps (michi-maker,
tcgscan-app): clients for the `tcgscan-data` server (catalog / prices /
embedding similarity), the search-box **query grammar** (+ its "?" manual
content), and the **CatalogBrowser** React Native component.

Extracted from poke-michi so the two apps stop maintaining parallel copies —
one component, both apps, app-specific actions injected via props.

## Install (consumers)

```jsonc
// package.json
"dependencies": { "tcgscan-browse": "github:brassmonkey381/tcgscan-browse" }
```

`dist/` is committed, so installs need no build step. **Maintainers: run
`npm run build` before every commit** (CI-less by design; the consumers import
`dist/`).

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
});

export * from 'tcgscan-browse'; // apps import the kit through their shim
```

Then anywhere:

```tsx
import { CatalogBrowser, loadCatalog, usePriceSummary, findSimilar } from 'tcgscan-browse';
```

## What lives here vs. in the apps

| Here (shared) | In each app |
|---|---|
| Catalog types + loader (load-once, subscribe, prefetch) | View-model adapters (michi's `catalogCardToDemoCard`) |
| Price summary client + `formatUsd` | Aggregations (michi's binder/page totals) |
| `find_similar` RPC client | — |
| Query grammar + `QUERY_MANUAL` + `describeQuery` | — |
| `CatalogBrowser` + `CardActionModal` + session browse state + `BrowseTheme` | The `cardActions`/`quickAction` passed in (place, add-to-collection, quick-place…) + the app's `theme` override |
| Value analytics (`SetAnalytics`/`SeriesAnalytics`/`PriceChart`) | Where they navigate (`onOpenCard`) |

**Keep the grammar and `QUERY_MANUAL` in sync** when new enrichment fields land
in the catalog (see the tcgscan-data pipeline): `QueryableCard`, `fieldValues()`,
`WORD_FIELDS`, and `QUERY_MANUAL` update together.

## Status

- Consumed by **poke-michi** (michi-maker) and **tcgscan-expo** (the Expo app under
  `tcgscan-app/tcgscan-expo`), both on **v0.3.0** since 2026-07-07.
- **v0.3.0** — the card action sheet is now app-agnostic (`cardActions` +
  `CardAction` model; `onPickCard` is a back-compat default), value analytics
  (`SetAnalytics`/`SeriesAnalytics`/`PriceChart`) and inline `quickAction` ship from the
  package, and all surfaces theme via an injected `BrowseTheme` (default light). See
  `docs/ACTION-SHEET-PLAN.md` and `docs/BROWSE-FEATURES-PLAN.md` for the consumer wiring
  that remains in each app.
