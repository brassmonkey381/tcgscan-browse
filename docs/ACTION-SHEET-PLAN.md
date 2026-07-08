# Plan: make the card action sheet app-agnostic

Status: **package side DONE (v0.3.0)** · consumer wiring pending · Owner repo:
`tcgscan-browse` · Consumers: `tcgscan-app`, `poke-michi`

## Status update — 2026-07-07 (v0.3.0)

Landed in the package:

- `CardAction` / `BrowserBuiltins` / `CardActionsFactory` model in `src/actions.ts`
  (exported), plus `resolveActions` / `resolveLabel` helpers.
- `CardActionModal` is now a **dumb renderer** over resolved actions (primary first,
  then the rest, then Cancel) — it no longer knows about pockets.
- `CatalogBrowser` gained `cardActions?: (card, builtins) => CardAction[]`. The
  built-ins (`findSimilar`, `viewSet`) are constructed by the browser and handed to the
  factory (each `undefined` when N/A), so an app composes
  `[...appActions, builtins.findSimilar, builtins.viewSet]`.
- **Back-compat**: with no `cardActions`, the sheet falls back to a default primary that
  calls `onPickCard` (`Place in pocket` / `Replace "<occupant>"`) — so poke-michi keeps
  working unchanged. `onPickCard` is now optional.
- **Image 400 fixed**: the sheet loads `imageMedium ?? image` (640px webp).
- Colors come from an injected `BrowseTheme` (default light), so the sheet themes with
  the rest of the kit — see the theming note in BROWSE-FEATURES-PLAN.

**Remaining (consumer repos, not here):** bump both apps to v0.3.0 and pass explicit
`cardActions` — poke-michi's place/replace, tcgscan-app's `Add to collection` /
`View details` — then restart Metro `-c`. Until then both apps ride the back-compat
default (michi correct; tcgscan-app still lacks its own verbs).

---

### Original plan

## Why

Tapping a card in `CatalogBrowser` opens `CardActionModal`. Today its actions are
**hardcoded to poke-michi's binder model**:

- primary button label is `"Place in pocket"` / `Replace “<occupant>”`
- fixed props `onPlace` / `onSimilar` / `onViewSet`, driven by
  `CatalogBrowser`'s `onPickCard` + `selectedCardId` (pocket occupant).

That's wrong for `tcgscan-app`, which has no binder — it wants **Add to
collection** and **View details**. Right now tcgscan-app inherits michi's
"Place in pocket" wording. The sheet should be a **generic action list** each app
fills in.

## Target shape

Replace the fixed callbacks with an injected action model.

```ts
export interface CardAction {
  key: string;
  label: string | ((card: CatalogCard) => string); // dynamic (e.g. Replace “X”)
  kind?: 'primary' | 'default' | 'destructive';     // primary renders first/filled
  onPress: (card: CatalogCard) => void;
  available?: (card: CatalogCard) => boolean;        // hide per-card (default: shown)
}
```

`CatalogBrowser` gains:

```ts
cardActions?: (card: CatalogCard) => CardAction[]; // app-supplied, per card
```

`CardActionModal` becomes a dumb renderer over the resolved actions (primary
first, then the rest, then Cancel). It no longer knows about pockets.

### Built-in, package-intrinsic actions

`Find similar` and `View set` manipulate the browser's *own* state (open the
similar view; jump the drill-down) or call the data server — they can't live in
app code cleanly. Keep them as **opt-in built-ins** the app can include:

```ts
// helpers the package exports so an app can compose them into its list
browserActions.findSimilar   // present only when similarAvailable()
browserActions.viewSet
```

So an app's `cardActions` returns `[...appActions, browserActions.findSimilar, browserActions.viewSet]`.

### Per-app action lists

- **poke-michi**: `Place in pocket` / `Replace “<occupant>”` (primary) + built-ins.
  Migrate `CardPicker`/`HomeBrowse` to pass this explicitly.
- **tcgscan-app**: `Add to collection` (primary, → `addModal.open(card.id)`),
  `View details` (→ card detail route) + built-ins.

## Also fix here

- **Modal inspection image** uses the full-size `card.image`
  (`card-imgs/*.jpg`), which currently **400s** on the tcgscan-data backend
  (migration → content-hashed webp only). Change to `imageMedium ?? image` (the
  640px webp) so the sheet image loads. Benefits both apps.

## Migration / back-compat

- Keep `onPickCard` working as a thin shim (a default primary action) for one
  release, or migrate both apps in the same change. Since dist is committed and
  both apps pin the repo, do it as one coordinated bump:
  1. add `cardActions` + built-in helpers, make `CardActionModal` generic
  2. `npm run build`, commit src+dist, push `main`
  3. bump + wire explicit actions in poke-michi and tcgscan-app, restart Metro `-c`

## Related

- [BROWSE-FEATURES-PLAN.md](./BROWSE-FEATURES-PLAN.md) — inline/quick card
  actions in the list reuse this same `CardAction` model.
