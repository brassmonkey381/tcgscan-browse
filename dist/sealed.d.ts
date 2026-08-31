import type { CardLanguage } from './catalog';
export interface SealedProduct {
    id: string;
    name: string;
    setId: string;
    series: string;
    releaseDate: string;
    image: string;
    imageSmall: string;
    imageMedium: string;
    /** Printing language: 'en' | 'ja'. Read from the artifact's `language` field when present;
     *  otherwise derived from the JP ' -JP' series suffix (see sealedLanguageOf). Defaults 'en'. */
    language: CardLanguage;
}
/** Derive a sealed product's printing language. Prefers an explicit `language` field (stamped by
 *  the combined publish); falls back to the pipeline's ' -JP' series-name suffix for artifacts
 *  published before the field existed. Defaults to English. */
export declare function sealedLanguageOf(p: {
    language?: string;
    series?: string;
}): CardLanguage;
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
 *
 * `status` distinguishes the two nulls. Without it a failed fetch is indistinguishable from a
 * slow one, and every consumer sits on "Loading…" forever — the kit's own rule is that a failure
 * degrades visibly rather than hanging. Purely additive: `sealed` and `priceOf` are unchanged, so
 * a caller that destructures only those two behaves exactly as before.
 */
export declare function useSealed(): {
    sealed: SealedCatalog | null;
    priceOf: (id: string) => number;
    status: 'loading' | 'ready' | 'error';
};
