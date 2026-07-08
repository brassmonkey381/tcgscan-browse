import type { Catalog } from './catalog';
import { type BrowseTheme } from './theme';
/** Set-level value analytics. `onOpenCard` navigates (app-supplied). */
export declare function SetAnalytics({ catalog, setId, onOpenCard, theme, }: {
    catalog: Catalog;
    setId: string;
    onOpenCard: (cardId: string) => void;
    theme?: BrowseTheme;
}): import("react").JSX.Element;
/** Series-level value analytics — the same view over every card in the series. */
export declare function SeriesAnalytics({ catalog, seriesId, onOpenCard, theme, }: {
    catalog: Catalog;
    seriesId: string;
    onOpenCard: (cardId: string) => void;
    theme?: BrowseTheme;
}): import("react").JSX.Element;
/**
 * One card's price history: a variant toggle (priciest variant first) over the shared
 * value-over-time chart. Cards open here in the action sheet; this is the detail chart.
 */
export declare function PriceChart({ cardId, theme }: {
    cardId: string;
    theme?: BrowseTheme;
}): import("react").JSX.Element;
export interface ValuePoint {
    d: string;
    v: number;
}
/** Presentational value-over-time line chart. `series` null = still loading. */
export declare function ValueOverTimeChart({ title, series, loadingLabel, theme, }: {
    title: string;
    series: ValuePoint[] | null;
    loadingLabel?: string;
    theme?: BrowseTheme;
}): import("react").JSX.Element;
