import type { Catalog } from './catalog';
/** Set-level value analytics. `onOpenCard` navigates (app-supplied). */
export declare function SetAnalytics({ catalog, setId, onOpenCard, }: {
    catalog: Catalog;
    setId: string;
    onOpenCard: (cardId: string) => void;
}): import("react").JSX.Element;
export interface ValuePoint {
    d: string;
    v: number;
}
/** Presentational value-over-time line chart. `series` null = still loading. */
export declare function ValueOverTimeChart({ title, series, loadingLabel, }: {
    title: string;
    series: ValuePoint[] | null;
    loadingLabel?: string;
}): import("react").JSX.Element;
