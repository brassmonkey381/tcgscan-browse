export interface SealedProduct {
    id: string;
    name: string;
    setId: string;
    series: string;
    releaseDate: string;
    image: string;
    imageSmall: string;
    imageMedium: string;
}
export interface SealedSet {
    id: string;
    name: string;
    code: string;
    series: string;
    productCount: number;
}
export interface SealedCatalog {
    products: SealedProduct[];
    sets: Map<string, SealedSet>;
    /** Products newest-first (empty dates last) — the natural carousel order. */
    newestFirst(): SealedProduct[];
}
/** Load-once sealed catalog (browse/sealed.json). */
export declare function loadSealed(): Promise<SealedCatalog>;
/** Load-once sealed headline values: product id -> cur (prices-summary-sealed.json). */
export declare function loadSealedPrices(): Promise<Record<string, number>>;
/**
 * React hook: the sealed catalog + prices, loading both once app-wide. `sealed` is null
 * until loaded (fail → stays null and a later mount retries); prices default to {}.
 */
export declare function useSealed(): {
    sealed: SealedCatalog | null;
    priceOf: (id: string) => number;
};
