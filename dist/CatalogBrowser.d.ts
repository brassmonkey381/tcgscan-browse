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
    /** Surface value analytics: a Cards | Analytics toggle in a set (SetAnalytics)
     *  plus a headline value under each card tile. Off by default — apps that don't
     *  want pricing (e.g. michi's binder picker) simply omit it. */
    analytics?: boolean;
}
/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export declare function CatalogBrowser({ catalog, selectedCardId, onPickCard, footer, analytics }: CatalogBrowserProps): import("react").JSX.Element;
export {};
