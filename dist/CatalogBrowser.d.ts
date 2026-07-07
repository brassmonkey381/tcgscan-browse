import { type ReactNode } from 'react';
import { type Catalog } from './catalog';
interface CatalogBrowserProps {
    catalog: Catalog;
    /** The card currently placed in the pocket (for the selected highlight), if any. */
    selectedCardId?: string;
    onPickCard: (cardId: string) => void;
    /** Artwork-panel + tonal-insert sections, rendered as the list footer so they stay
     *  reachable below the browse without a second scroller. */
    footer: ReactNode;
}
/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export declare function CatalogBrowser({ catalog, selectedCardId, onPickCard, footer }: CatalogBrowserProps): import("react").JSX.Element;
export {};
