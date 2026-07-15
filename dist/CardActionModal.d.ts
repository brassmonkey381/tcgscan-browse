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
/**
 * Multi-select action sheet — shown when 2+ cards are selected (Ctrl/Shift-click on web).
 * The image area crams every selected thumb into the usual footprint (scrolls if they
 * overflow), then offers the batch actions. Buttons are hidden when their handler is absent
 * (e.g. no "Find similar to all" when the data server isn't configured).
 */
export declare function MultiCardActionModal({ cards, onAddAll, addAllLabel, onFindSimilarAll, onMoreLikeAll, onLessLikeAll, onClose, theme, }: {
    cards: CatalogCard[];
    /** The batch-add action (app-supplied). Omit to hide the button. */
    onAddAll?: () => void;
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
