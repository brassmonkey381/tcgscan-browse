# Plan: move all catalog-browsing features into tcgscan-browse

Status: **intended, not started** · Owner repo: `tcgscan-browse` · Consumers: `tcgscan-app`, `poke-michi`

## Why

`tcgscan-browse` exists to be the one place both apps browse the data that
**tcgscan-data** publishes (catalog, prices, images, similarity). Today the
package ships the core browser (`CatalogBrowser`: series → set → card, search,
facets, find-similar, headline price labels), but several *browsing* features
still live only in `tcgscan-app` as parallel screens/components:

- **Set analytics** — value tiles (total / priced count / avg), a top-K
  cards-by-value bar chart colored by rarity, and set value-over-time.
  (`tcgscan-app/src/components/set-analytics.tsx`)
- **Series analytics** — the series-level version.
  (`tcgscan-app/src/components/series-analytics.tsx`)
- **Per-card price column** in the set card-list, and a **quick “＋add”** action
  on each row. (`tcgscan-app/src/app/(tabs)/browse/set/[setId].tsx`)
- The supporting charts `value-over-time-chart.tsx` and `price-chart.tsx`
  (react-native-svg).

Because these are all "browse the tcgscan-data corpus," they belong in the
shared package so both apps get them once and stay in parity. When `tcgscan-app`
adopted `CatalogBrowser` (2026-07), these features were orphaned — this plan
brings them home.

## Target shape

Everything below becomes exported by `tcgscan-browse`, so an app is a thin
consumer:

1. **`<SetAnalytics setId />` and `<SeriesAnalytics seriesId />`** — ported from
   tcgscan-app. They already depend only on package data (`getPriceSummary`,
   `getCardPrices`, the `Catalog`), so the port is mostly moving files +
   swapping the app's `useTheme`/router for injected props (a `theme` object and
   an `onOpenCard(cardId)` callback — the package must not import expo-router).
2. **Analytics surface inside `CatalogBrowser`** — the set level gains a
   `Cards | Analytics` toggle (matching tcgscan-app's current set screen), so
   analytics is reachable in-flow rather than a separate route.
3. **Per-card price + inline actions in the card list** — `CatalogBrowser`
   already loads `usePriceSummary`; expose:
   - `showPrices?: boolean` — render each card's headline value on its
     row/tile.
   - inline quick actions via the action model in
     [ACTION-SHEET-PLAN.md](./ACTION-SHEET-PLAN.md) (e.g. tcgscan-app's “＋add”,
     michi's quick-place), so the app injects the button rather than the package
     hardcoding it.
4. **Charts** — move `ValueOverTimeChart` and `PriceChart` into the package.
   Add **`react-native-svg`** to `peerDependencies` (both apps already have it).

## Consumer cleanup (tcgscan-app)

Once the above lands and the dep is bumped, delete from `tcgscan-app`:
`components/set-analytics.tsx`, `components/series-analytics.tsx`,
`components/value-over-time-chart.tsx`, `components/price-chart.tsx`, and the now
fully-superseded routed browse screens `browse/[seriesId].tsx`,
`browse/set/[setId].tsx` (the tab already mounts `CatalogBrowser`). `poke-michi`
opts into analytics wherever it mounts the browser.

## Open questions

- Theming: the package needs a small injected `theme` contract (colors) rather
  than importing either app's theme. Define a `BrowseTheme` type.
- Navigation: package components take `onOpenCard`/`onOpenSet` callbacks; apps
  wire them to their own routers. No expo-router import in the package.
- Does `poke-michi` want the analytics surfaced too? (Assume yes — free parity.)

## Related

- [ACTION-SHEET-PLAN.md](./ACTION-SHEET-PLAN.md) — the per-app action model the
  inline/quick actions depend on.
