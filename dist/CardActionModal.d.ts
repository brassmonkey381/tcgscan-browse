import type { CardAction } from './actions';
import { type CatalogCard } from './catalog';
import { type BrowseTheme } from './theme';
interface CardActionModalProps {
    card: CatalogCard;
    /** Resolved actions (already filtered by `available`), in app-supplied order. */
    actions: CardAction[];
    /** Headline value, 0 when unpriced. */
    value: number;
    onClose: () => void;
    theme?: BrowseTheme;
}
export declare function CardActionModal({ card, actions, value, onClose, theme }: CardActionModalProps): import("react").JSX.Element;
export declare function fitSelectionGrid(n: number, W: number, H: number): {
    cols: number;
    w: number;
};
export declare function MultiCardActionModal({ cards, onAddAll, addActions, big, addAllLabel, onFindSimilarAll, onMoreLikeAll, onLessLikeAll, onClose, theme, }: {
    cards: CatalogCard[];
    /** The batch-add action (app-supplied). Omit to hide the button. */
    onAddAll?: () => void;
    /** Several add actions side by side instead of the one (e.g. "Add to hand" | "Add to page"). */
    addActions?: {
        label: string;
        onPress: () => void;
    }[];
    /** The big selection grid (see fitSelectionGrid). */
    big?: boolean;
    /** Label for the batch-add button — apps word it for their container
     *  ("Add all to a binder" / "Add all to portfolio" / …). */
    addAllLabel?: string;
    /** "Find similar to all" (kit-supplied embedding search). Omit to hide the button. */
    onFindSimilarAll?: () => void;
    /** Refine the ongoing similarity session toward this group (similar mode only). */
    onMoreLikeAll?: () => void;
    /** Refine the ongoing similarity session away from this group (similar mode only). */
    onLessLikeAll?: () => void;
    onClose: () => void;
    theme?: BrowseTheme;
}): import("react").JSX.Element;
export {};
