/** cardId -> latest headline value. cur = priciest variant's last market price. */
export interface PriceSummaryEntry {
    cur: number;
    date: string;
    variants: Record<string, number>;
}
export type PriceSummary = Record<string, PriceSummaryEntry>;
export interface SecondaryPriceSummary {
    /** Stable id for this source, e.g. 'onepiece'. Registering the same key twice is a no-op. */
    key: string;
    /** Bucket root holding its `prices-summary.json` (the other game's browseUrl). */
    browseUrl: string;
}
/**
 * Declare another game whose prices belong in the summary. Idempotent, safe at import time, and
 * cheap: it only drops any loaded copy so the next read re-merges.
 *
 * IDS ARE ONE NAMESPACE (TCGplayer productIds) across every game, so a merge cannot collide in
 * practice; where it somehow does, the PRIMARY game wins, because that is the catalog this host is
 * built around.
 */
export declare function registerPriceSummary(source: SecondaryPriceSummary): void;
/** Load-once summary fetch (shared by every subscriber), primary plus any registered game. */
export declare function getPriceSummary(): Promise<PriceSummary>;
/** Synchronous view of the summary once loaded (null before). Lets pure helpers
 *  read prices without threading state. */
export declare function priceSnapshot(): PriceSummary | null;
/** The summary map, or null while loading. Never throws — {} on failure. */
export declare function usePriceSummary(): PriceSummary | null;
/** "$1,234.56" (en-US), or '' for a zero/absent value. */
export declare function formatUsd(value: number): string;
/** One observation. m = market price, a = avg sales price, q = listing quantity. */
export interface PricePoint {
    d: string;
    m: number | null;
    a: number | null;
    q: number;
}
export interface CardPrices {
    productId: string;
    variants: Record<string, PricePoint[]>;
}
export type TimeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';
export declare const TIME_RANGES: TimeRange[];
/** yyyy-mm-dd cutoff for a range, or '' for ALL. String compare is date-safe here. */
export declare function rangeCutoff(range: TimeRange): string;
/** Keep only points on/after the range cutoff (already date-sorted ascending). */
export declare function windowByRange(points: PricePoint[], range: TimeRange): PricePoint[];
/** Most recent non-null market price in a series. */
export declare function lastMarket(points: PricePoint[]): number | null;
/** Variant names for a card, ordered by current value (priciest first). */
export declare function orderedVariants(prices: CardPrices): string[];
/** % change from the first to the last market point in a (windowed) series. */
export declare function pctChange(points: PricePoint[]): number | null;
/** Full price history for one card, or null if unpriced. Cached per productId. */
export declare function getCardPrices(productId: string): Promise<CardPrices | null>;
export type ValueSeriesKind = 'set' | 'series';
/** One total-value observation for a set/series (matches analytics' ValuePoint). */
export interface ValueSeriesPoint {
    d: string;
    v: number;
}
/** Precomputed value-over-time for a set or series, or null if not published yet. */
export declare function getValueSeries(kind: ValueSeriesKind, id: string): Promise<ValueSeriesPoint[] | null>;
