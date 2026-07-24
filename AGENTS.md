# Agent guidance — tcgscan-browse

Shared MIT npm package: the Pokemon TCG card-browse kit consumed by **two apps**
(poke-michi / michi-maker and tcgscan-expo under tcgscan-app) as a git
dependency (`github:brassmonkey381/tcgscan-browse`, tracking `main`). It is the
seam between the apps — anything both apps share lives here, never copied into
an app.

## Hard rules

- **API changes break two apps at once.** Both consumers pin `main`, so treat
  every exported symbol/prop as public API. Prefer additive changes (new
  optional props, back-compat defaults); coordinate consumer bumps otherwise.
- **Read-only against tcgscan-data.** The kit only reads the shared Supabase
  project (public artifacts under `browseUrl`, PostgREST + RPCs under
  `apiUrl`). Never add writes, service keys, or auth logic here.
- **No app-specific or user-data code.** No routers, no app themes, no
  env reads (Expo can't inline `EXPO_PUBLIC_*` in node_modules — apps inject
  via `configureBrowse`), no collections/binders/auth. App behavior is injected
  via props (`cardActions`, `quickAction`, `theme`, `ownedIds`, callbacks) or
  `configureBrowse` (incl. the `catalogSource` seam for the gated catalog).
- **Grammar sync.** When searchable fields change, update together:
  `QueryableCard`, `fieldValues()`, `WORD_FIELDS`, and **`QUERY_MANUAL`** (all
  in `src/query.ts`) — plus the `search_cards` RPC in tcgscan-data, which must
  mirror the client semantics exactly (warm == cold parity). Checklist in
  `docs/ARCHITECTURE.md`.
- **Everything fails soft.** Server features (search, similarity, color,
  prices) degrade to empty results, never hard errors — keep it that way.

## Build / release

TypeScript compiles `src/` → `dist/` (`tsc`, declarations on); `dist/` is
**committed** so consumers install without a build step. No CI, no git tags, no
npm publish. To cut a version:

1. `npm run check` (typecheck), then `npm run build` — never hand-edit `dist/`.
2. Bump `version` in `package.json`.
3. One commit with src + dist + package.json, message
   `feat(scope): vX.Y.Z — summary` (see `git log` for the convention).
4. Push `main`; the consumer apps then bump the dep and restart Metro `-c`.

Do not commit or push unless the user asks.

## Layout

- `src/index.ts` — the single export surface (everything public re-exports here).
- `src/CatalogBrowser.tsx` — the main component (warm catalog + cold
  server-search paths); `CardActionModal.tsx`, `RecentProducts.tsx`,
  `analytics.tsx` are the other UI surfaces.
- `src/query.ts` — grammar + `QUERY_MANUAL` (see grammar sync above).
- Clients: `catalog.ts` (normalization boundary — the only place the wire's
  snake_case is known), `search.ts` (search_cards / search_facets /
  card_detail RPCs + PostgREST fetches), `prices.ts`, `similar.ts`, `color.ts`,
  `sealed.ts`, `taxonomy.ts`, `images.ts`.
- `src/config.ts` — `configureBrowse` (the only config entry point),
  `state.ts` / `savedSearches.ts` — session state + browse commands.
- `docs/ARCHITECTURE.md` is the reference doc; the other docs are shipped
  plans/audits kept as history.

Peer deps: react, react-native, expo-image, react-native-svg — never add an
app-only dependency.
