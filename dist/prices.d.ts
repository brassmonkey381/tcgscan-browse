/** cardId -> latest headline value. cur = priciest variant's last market price. */
export interface PriceSummaryEntry {
    cur: number;
    date: string;
    variants: Record<string, number>;
}
export type PriceSummary = Record<string, PriceSummaryEntry>;
/** Load-once summary fetch (shared by every subscriber). */
export declare function getPriceSummary(): Promise<PriceSummary>;
/** Synchronous view of the summary once loaded (null before). Lets pure helpers
 *  read prices without threading state. */
export declare function priceSnapshot(): PriceSummary | null;
/** The summary map, or null while loading. Never throws — {} on failure. */
export declare function usePriceSummary(): PriceSummary | null;
/** "$1,234.56" (en-US), or '' for a zero/absent value. */
export declare function formatUsd(value: number): string;
