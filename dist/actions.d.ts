/**
 * The app-agnostic card action model.
 *
 * Tapping a card in `CatalogBrowser` opens `CardActionModal`, which is a dumb
 * renderer over a list of `CardAction`s the app supplies (`cardActions`). The
 * package no longer hardcodes poke-michi's "Place in pocket" — each app fills in
 * its own verbs (michi: place/replace; tcgscan-app: add to collection / details).
 *
 * Two actions can't live in app code cleanly because they drive the browser's own
 * state or the data server — `Find similar` and `View set`. The browser builds
 * those as `BrowserBuiltins` and passes them to the `cardActions(card, builtins)`
 * factory, so an app composes `[...appActions, builtins.findSimilar, builtins.viewSet]`.
 */
import type { CatalogCard } from './catalog';
export interface CardAction {
    /** Stable key (React list key + de-dup). */
    key: string;
    /** Button label; a function for per-card text (e.g. Replace "<occupant>"). */
    label: string | ((card: CatalogCard) => string);
    /** primary → filled + first; destructive → danger tint; default → outline. */
    kind?: 'primary' | 'default' | 'destructive';
    onPress: (card: CatalogCard) => void;
    /** Hide this action for some cards (default: always shown). */
    available?: (card: CatalogCard) => boolean;
}
/**
 * Built-in, package-intrinsic actions the browser binds to its own state and hands
 * to the app's `cardActions` factory. A field is `undefined` when not applicable
 * (no similarity server configured; card has no set), so an app can spread then
 * `.filter(Boolean)` — or the browser's default composition does it for them.
 */
export interface BrowserBuiltins {
    findSimilar?: CardAction;
    viewSet?: CardAction;
}
/** The per-card action factory an app supplies to `CatalogBrowser`. */
export type CardActionsFactory = (card: CatalogCard, builtins: BrowserBuiltins) => CardAction[];
/** Resolve a static or dynamic label against a card. */
export declare function resolveLabel(action: CardAction, card: CatalogCard): string;
/** Drop actions hidden for this card via `available`. */
export declare function resolveActions(actions: CardAction[], card: CatalogCard): CardAction[];
