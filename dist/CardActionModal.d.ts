import type { CardAction } from './actions';
import type { CatalogCard } from './catalog';
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
export {};
