import type { CatalogCard } from './catalog';
interface CardActionModalProps {
    card: CatalogCard;
    /** Current pocket occupant (if any) — turns "Place" into an explicit "Replace". */
    occupant?: CatalogCard;
    /** Headline value, 0 when unpriced. */
    value: number;
    onPlace: () => void;
    onSimilar?: () => void;
    onViewSet?: () => void;
    onClose: () => void;
}
export declare function CardActionModal({ card, occupant, value, onPlace, onSimilar, onViewSet, onClose, }: CardActionModalProps): import("react").JSX.Element;
export {};
