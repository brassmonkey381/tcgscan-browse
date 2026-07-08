# Plan: make the card action sheet app-agnostic

Status: **intended, not started** · Owner repo: `tcgscan-browse` · Consumers: `tcgscan-app`, `poke-michi`

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
