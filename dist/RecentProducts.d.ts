import { type Catalog, type CatalogCard } from './catalog';
import { type BrowseTheme } from './theme';
/** The set identity a feed tile carries — same fields warm (catalog) and cold (REST). */
export interface FeedSet {
    id: string;
    name: string;
    seriesId: string;
    releaseDate: string;
    cardCount: number;
    /** Official set logo, '' when unknown. */
    coverUri: string;
}
interface RecentProductsProps {
    /** The loaded catalog, or null to run catalog-FREE (the feed fetches its own slim data
     *  from the public cards/sets tables — same three carousels either way). */
    catalog: Catalog | null;
    /**
     * How far back (in months) a released set stays in the feed. Every set from this
     * window plus all upcoming (future-dated) sets are shown, newest first. Default 12.
     */
    monthsBack?: number;
    /** How many chase cards to montage per set tile. Default 3. */
    montageCount?: number;
    /** Max cards in the card carousel. Default 40. */
    cardLimit?: number;
    /**
     * Keep only cards this predicate accepts (e.g. "double rares and higher") in the card carousel
     * AND the set-tile montages. When set, the card carousel is also built to SPAN every set in the
     * window — one card from each set per round (priciest first), so all shown sets are represented
     * rather than the newest sets crowding out the rest. Omitted → every rarity, newest-first mix.
     */
    rarityFilter?: (card: CatalogCard) => boolean;
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
    onOpenSet?: (set: FeedSet) => void;
    /**
     * Drop the tapped card into a binder — surfaced as the PRIMARY "Add to a binder…" action
     * (a host chooser then picks the target binder). When wired, TCGPlayer demotes to a
     * secondary action. Omitted → the action is hidden (TCGPlayer stays primary).
     */
    onAddToBinder?: (card: CatalogCard) => void;
}
export declare function RecentProducts({ catalog, monthsBack, montageCount, cardLimit, rarityFilter, theme: themeProp, title, onFindSimilar, onViewSet, onOpenSet, onAddToBinder, }: RecentProductsProps): import("react").JSX.Element | null;
export {};
