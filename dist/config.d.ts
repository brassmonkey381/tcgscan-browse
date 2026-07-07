/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */
export interface BrowseConfig {
    /**
     * Base URL for catalog.json / prices-summary.json / alternates.json.
     * '/browse' (site-root relative) for local static files on web; the
     * tcgscan-data browse bucket URL when hosted. Native builds need an
     * absolute URL.
     */
    browseUrl: string;
    /**
     * Base prepended to site-root-relative image paths (and the root the
     * card-imgs / card-thumbs buckets hang off). '' for local static on web.
     */
    imgBase: string;
    /** PostgREST endpoint of the data server ('' disables dynamic queries). */
    apiUrl?: string;
    /** Publishable (anon) key for PostgREST reads. */
    apiKey?: string;
}
/** Set the data-server origins. Call once from the app before any browse use. */
export declare function configureBrowse(next: BrowseConfig): void;
export declare function getBrowseUrl(): string;
export declare function getImgBase(): string;
export declare function getApiUrl(): string;
export declare function getApiKey(): string;
/**
 * Resolve a raw catalog image path to a fully-usable image URL. Absolute URLs
 * (`http(s)://…`) pass through untouched; site-root-relative paths get the
 * imgBase prepended so an origin swap stays centralized here.
 */
export declare function resolveImageUrl(path: string): string;
/**
 * Image tiers, keyed by a card's stable id — deterministic bucket paths, so a
 * card's image can be shown WITHOUT loading the ~25MB catalog.json first:
 *   - 245 → `card-thumbs/245/<id>.webp` (grids / covers; complete for every card)
 *   - 640 → `card-thumbs/640/<id>.webp` (binder-page view)
 *   - 'full' → `card-imgs/<id>.jpg` (full size; the safe fallback if a webp 404s)
 * Requires imgBase to point at the bucket's public root.
 */
export declare function cardThumbUrl(id: string, tier: 245 | 640 | 'full'): string;
