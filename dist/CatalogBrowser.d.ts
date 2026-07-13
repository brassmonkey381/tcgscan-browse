import { type ReactNode } from 'react';
import { type CardAction, type CardActionsFactory } from './actions';
import { type Catalog, type CatalogCard } from './catalog';
import { type BrowseTheme } from './theme';
interface CatalogBrowserProps {
    /**
     * The in-memory catalog. Pass `undefined`/`null` while it's still loading to get the COLD
     * path: text search runs against the data server's `search_cards` RPC (instant, no catalog),
     * and the drill-down / facets / similar surface once the catalog resolves (the consumer just
     * passes it through from `useCatalog`). When set, everything is on-device as before.
     */
    catalog?: Catalog | null;
    /** The card currently placed in the pocket (for the selected highlight), if any. */
    selectedCardId?: string;
    /**
     * Legacy/default primary action. When supplied and `cardActions` is omitted, the sheet
     * shows a "Place in pocket" / Replace "<occupant>" primary that calls this — preserving
     * poke-michi's binder behavior. Apps with a richer action set pass `cardActions` instead.
     */
    onPickCard?: (cardId: string) => void;
    /**
     * Place an assembled V-UNION (its four ordered piece ids) — the Size=V-UNION group tiles
     * call this. Omit if the app can't place a 2×2 V-UNION (the group tiles then no-op).
     */
    onPickVUnion?: (pieces: readonly string[]) => void;
    /**
     * Multi-select batch placement: the ids selected via Ctrl/Shift-click (web). Wired to the
     * "Add all to a binder" action. Omit to hide that action (e.g. surfaces with no binder).
     */
    onPickCards?: (cardIds: string[]) => void;
    /**
     * App-supplied per-card action list for the tap sheet. Receives the browser's
     * `BrowserBuiltins` (findSimilar / viewSet / viewIllustrator, each present only when
     * applicable) so the app composes
     * `[...appActions, builtins.findSimilar, builtins.viewSet, builtins.viewIllustrator]`.
     * When omitted, the sheet falls back to the `onPickCard` default above.
     */
    cardActions?: CardActionsFactory;
    /**
     * Optional inline quick action rendered as a compact corner pill on each card tile
     * (e.g. tcgscan-app's "＋" add, michi's quick-place). Return `undefined` to omit it for a
     * card. Its `label` should be short (a glyph or 1–2 chars) — it's tiny. Tapping it fires
     * the action WITHOUT opening the sheet. Reuses the shared `CardAction` model.
     */
    quickAction?: (card: CatalogCard) => CardAction | undefined;
    /** Where analytics tiles/bars navigate on tap. Defaults to `onPickCard`. */
    onOpenCard?: (cardId: string) => void;
    /** Artwork-panel + tonal-insert sections, rendered as the list footer so they stay
     *  reachable below the browse without a second scroller. */
    footer: ReactNode;
    /** Surface value analytics: a Cards | Analytics toggle in a set (SetAnalytics)
     *  plus a headline value under each card tile. Off by default — apps that don't
     *  want pricing (e.g. michi's binder picker) simply omit it. */
    analytics?: boolean;
    /** Injected color contract (partial override merged over the light default). */
    theme?: Partial<BrowseTheme>;
    /**
     * Target width (px) for each card thumbnail — the grid packs as many columns as fit, then
     * divides the measured width evenly, so a larger value yields fewer, bigger cards. Defaults
     * to the dense browse default; consumers wanting binder-sized cards pass e.g. ~140.
     */
    cardTileWidth?: number;
    /** Height (px) of each series/set art tile. Larger = taller cover art. Defaults to the
     *  standard tile height. */
    taxTileHeight?: number;
    /**
     * One-shot "find similar to all" seed: card ids to run a multi-card similarity search on
     * as soon as this browser mounts. Unlike `sendBrowseCommand({type:'similarMany'})`, this is
     * an explicit prop, so it can't be intercepted by another `CatalogBrowser` mounted elsewhere
     * on the screen — the binder picker uses it so its seed survives the per-pocket remount.
     * Applied once per distinct array reference (pass a fresh array to re-run).
     */
    initialSimilar?: string[];
}
/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export declare function CatalogBrowser({ catalog, selectedCardId, onPickCard, onPickVUnion, onPickCards, cardActions, quickAction, onOpenCard, footer, analytics, theme: themeProp, cardTileWidth, taxTileHeight, initialSimilar, }: CatalogBrowserProps): import("react").JSX.Element;
export {};
