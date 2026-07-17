/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */
import type { RawCatalog } from './catalog';
import { type ManifestCache } from './images';
/**
 * App-supplied catalog loader — the seam for a GATED/ENCRYPTED catalog (see
 * docs/DATA-PROTECTION-PLAN.md). When set, the kit calls this instead of fetching the public
 * `catalog.json`; the app owns auth + decryption + decoding and returns the parsed `RawCatalog`.
 * Report download progress via `onProgress` so the load bar still animates. Omit for the default
 * public-bucket fetch (back-compat).
 */
export type CatalogSource = (onProgress?: (received: number, total: number) => void) => Promise<RawCatalog>;
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
    /**
     * Optional persistent cache (AsyncStorage / localStorage adapter) for the
     * content-hashed image manifest — enables instant first paint across launches.
     * See hydrateImageManifest / cardThumbUrl.
     */
    cache?: ManifestCache;
    /**
     * Gated/encrypted catalog loader (see CatalogSource / DATA-PROTECTION-PLAN.md). When set, the
     * kit uses it to obtain the catalog instead of fetching the public `catalog.json`. Omit for the
     * default public fetch.
     */
    catalogSource?: CatalogSource;
}
/** Set the data-server origins. Call once from the app before any browse use. */
export declare function configureBrowse(next: BrowseConfig): void;
/** The app-supplied gated catalog loader, or null for the default public fetch. */
export declare function getCatalogSource(): CatalogSource | null;
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
 * TCGPlayer product page for a card — a pure function of its id (verified 100% of
 * the catalog). Stored per-card in the old fat catalog; derive it instead.
 */
export declare function productUrl(id: string): string;
/**
 * TCGPlayer category page for a SET, from the sets table's `url_name`
 * ("ME05 Pitch Black" → …/pokemon/me05-pitch-black). '' when the name is empty.
 */
export declare function setShopUrl(urlName: string): string;
/**
 * TCGPlayer CDN image for a card — a pure `{id}` template (the `<id>_in_NxN.jpg` convention).
 *
 * @deprecated NO LONGER USED as an image fallback anywhere: the CDN now 403s hotlinked pulls
 * (and never sent CORS headers to begin with), so requesting it only burns a doomed fetch.
 * Kept exported only so downstream consumers keep compiling; do not reintroduce it as a
 * fallback — unmirrored cards should render their placeholder until the pipeline mirrors them.
 */
export declare function cdnImageUrl(id: string, size?: number): string;
/**
 * Image tiers, keyed by a card's stable id — so a card's image resolves WITHOUT the
 * per-card image URLs living in catalog.json:
 *   - 245 → 245px webp (grids / covers; complete for every mirrored card)
 *   - 640 → 640px webp (binder-page / inspection view)
 *   - 'full' → full-size jpg
 * Hosted buckets key images by content hash, so the URL comes from the image
 * manifest (hydrateImageManifest). If the manifest is loaded but the card's tier
 * isn't in it, fall back to the card's mirrored full image; a wholly unmirrored
 * card resolves to '' (placeholder) — the TCGPlayer CDN is NOT used (it 403s
 * hotlinked pulls now, and we don't want to lean on it regardless). Only before
 * the manifest has loaded at all (static/offline) do we use the flat
 * convention path.
 */
export declare function cardThumbUrl(id: string, tier: 245 | 640 | 'full'): string;
