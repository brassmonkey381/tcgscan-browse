import type { CardLanguage } from './catalog';
/** Canonical order — a stored/derived value is always re-sorted into this, so identity is stable
 *  regardless of the order the user tapped the pills in. */
export declare const LANGUAGE_ORDER: CardLanguage[];
/** Display label for a printing language (also the `language` facet's chip values). */
export declare function languageLabel(code: CardLanguage): string;
/** Short label for the toggle pills. */
export declare function languageShortLabel(code: CardLanguage): string;
/** Canonical order, valid codes only, never empty — a surface constrained to nothing shows
 *  nothing, which reads as a broken app rather than a filter. */
export declare function normalizeLanguages(v: unknown): CardLanguage[];
/** The current EN/JP preference. Safe to call outside React (the clients read it this way). */
export declare function getBrowseLanguages(): CardLanguage[];
/**
 * Set the preference and persist it through the configured `languageStore`. Pass
 * `{ persist: false }` when ADOPTING an external value (hydration, an account profile arriving)
 * so the kit doesn't echo it straight back to storage.
 */
export declare function setBrowseLanguages(next: CardLanguage[], opts?: {
    persist?: boolean;
}): void;
/** Subscribe to preference changes (non-React callers). Returns an unsubscribe. */
export declare function subscribeBrowseLanguages(callback: () => void): () => void;
/**
 * Load the persisted preference through the app-supplied store, once per session. Called
 * automatically by `useBrowseLanguages`; call it directly if a non-React surface needs the
 * stored value early. Adopting does NOT write back.
 */
export declare function hydrateBrowseLanguages(): Promise<void>;
/**
 * The shared EN/JP preference and a setter, as a hook. Every caller shares one value, so a
 * toggle rendered in a header updates a browser elsewhere on the page.
 */
export declare function useBrowseLanguages(): [CardLanguage[], (v: CardLanguage[]) => void];
/**
 * Resolve the effective language bound for a search call: an explicit per-call/per-instance
 * value wins, otherwise the shared preference. Returns `undefined` when the result is
 * unconstrained (both languages), so callers omit the argument entirely and the server takes
 * its cheaper unbounded path.
 */
export declare function effectiveLanguages(explicit?: CardLanguage[]): CardLanguage[] | undefined;
