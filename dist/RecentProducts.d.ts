import { type Catalog } from './catalog';
import { type BrowseTheme } from './theme';
interface RecentProductsProps {
    catalog: Catalog;
    /**
     * How far back (in months) a released set stays in the feed. Every set from this
     * window plus all upcoming (future-dated) sets are shown, newest first. Default 3.
     */
    monthsBack?: number;
    /** How many chase cards to montage per set tile. Default 3 (like the reference wall). */
    montageCount?: number;
    /** How many newest cards to show in the strip. Default 20; pass 0 to hide the strip. */
    cardLimit?: number;
    /** Injected color contract (partial override merged over the light default). */
    theme?: Partial<BrowseTheme>;
    /** Optional header title. Default "Recent Sets". */
    title?: string;
}
export declare function RecentProducts({ catalog, monthsBack, montageCount, cardLimit, theme: themeProp, title, }: RecentProductsProps): import("react").JSX.Element | null;
export {};
