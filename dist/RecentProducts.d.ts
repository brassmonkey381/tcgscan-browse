import { type Catalog, type CatalogCard, type CatalogSet } from './catalog';
import { type BrowseTheme } from './theme';
interface RecentProductsProps {
    catalog: Catalog;
    /**
     * How far back (in months) a released set stays in the feed. Every set from this
     * window plus all upcoming (future-dated) sets are shown, newest first. Default 12.
     */
    monthsBack?: number;
    /** How many chase cards to montage per set tile. Default 3. */
    montageCount?: number;
    /** Max cards per card carousel (upcoming / released). Default 40. */
    cardLimit?: number;
    /** Injected color contract (partial override merged over the light default). */
    theme?: Partial<BrowseTheme>;
    /** Header title. Default "Recent & Upcoming". */
    title?: string;
    /**
     * Show cards similar to the tapped one — surfaced as a "Find similar" modal action.
     * Wire this to another browser on the page (e.g. via `sendBrowseCommand`). Omitted →
     * the action is hidden.
     */
    onFindSimilar?: (card: CatalogCard) => void;
    /**
     * Open the tapped card's set — surfaced as a "View set" modal action. Wire this to
     * another browser on the page. Omitted → the action is hidden.
     */
    onViewSet?: (card: CatalogCard) => void;
    /**
     * Open a whole SET (from a set tile tap) — wire this to another browser on the page
     * (e.g. via `sendBrowseCommand({type:'viewSetById'})`). Omitted → set tiles aren't tappable
     * at the tile level (their montage cards still open the card action modal).
     */
    onOpenSet?: (set: CatalogSet) => void;
}
export declare function RecentProducts({ catalog, monthsBack, montageCount, cardLimit, theme: themeProp, title, onFindSimilar, onViewSet, onOpenSet, }: RecentProductsProps): import("react").JSX.Element | null;
export {};
