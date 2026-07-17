/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */
import { imageManifestReady, manifestUrl, setManifestCache } from './images';
const config = {
    browseUrl: '/browse',
    imgBase: '',
    apiUrl: '',
    apiKey: '',
};
let catalogSource = null;
/** Set the data-server origins. Call once from the app before any browse use. */
export function configureBrowse(next) {
    config.browseUrl = next.browseUrl;
    config.imgBase = next.imgBase;
    config.apiUrl = next.apiUrl ?? deriveApiUrl(next.browseUrl);
    config.apiKey = next.apiKey ?? '';
    catalogSource = next.catalogSource ?? null;
    setManifestCache(next.cache ?? null);
}
/** The app-supplied gated catalog loader, or null for the default public fetch. */
export function getCatalogSource() {
    return catalogSource;
}
/** `https://<ref>.supabase.co/storage/...` -> `https://<ref>.supabase.co/rest/v1`. */
function deriveApiUrl(browseUrl) {
    try {
        return `${new URL(browseUrl).origin}/rest/v1`;
    }
    catch {
        return '';
    }
}
export function getBrowseUrl() {
    return config.browseUrl;
}
export function getImgBase() {
    return config.imgBase;
}
export function getApiUrl() {
    return config.apiUrl;
}
export function getApiKey() {
    return config.apiKey;
}
/**
 * Resolve a raw catalog image path to a fully-usable image URL. Absolute URLs
 * (`http(s)://…`) pass through untouched; site-root-relative paths get the
 * imgBase prepended so an origin swap stays centralized here.
 */
export function resolveImageUrl(path) {
    if (!path)
        return '';
    if (/^https?:\/\//i.test(path))
        return path;
    return `${config.imgBase}${path}`;
}
/** cardThumbUrl tier → the image manifest field it resolves against. */
const TIER_FIELD = {
    '245': 'image_small',
    '640': 'image_medium',
    full: 'image',
};
/**
 * TCGPlayer product page for a card — a pure function of its id (verified 100% of
 * the catalog). Stored per-card in the old fat catalog; derive it instead.
 */
export function productUrl(id) {
    return id ? `https://www.tcgplayer.com/product/${id}` : '';
}
/**
 * TCGPlayer category page for a SET, from the sets table's `url_name`
 * ("ME05 Pitch Black" → …/pokemon/me05-pitch-black). '' when the name is empty.
 */
export function setShopUrl(urlName) {
    const slug = urlName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug
        ? `https://www.tcgplayer.com/categories/trading-and-collectible-card-games/pokemon/${slug}`
        : '';
}
/**
 * TCGPlayer CDN image for a card — a pure `{id}` template (the `<id>_in_NxN.jpg` convention).
 *
 * @deprecated NO LONGER USED as an image fallback anywhere: the CDN now 403s hotlinked pulls
 * (and never sent CORS headers to begin with), so requesting it only burns a doomed fetch.
 * Kept exported only so downstream consumers keep compiling; do not reintroduce it as a
 * fallback — unmirrored cards should render their placeholder until the pipeline mirrors them.
 */
export function cdnImageUrl(id, size = 1000) {
    return id ? `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_${size}x${size}.jpg` : '';
}
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
export function cardThumbUrl(id, tier) {
    if (!id)
        return '';
    const hashed = manifestUrl(id, TIER_FIELD[String(tier)]);
    if (hashed)
        return hashed;
    if (imageManifestReady()) {
        // Tier not mirrored yet: use the card's mirrored FULL image (our bucket serves CORS
        // headers). Wholly unmirrored → '' so consumers show their placeholder instead of
        // firing a doomed request at the TCGPlayer CDN (403 + no CORS).
        return manifestUrl(id, 'image') ?? '';
    }
    // Manifest not loaded yet (static/offline): flat convention path.
    if (tier === 'full')
        return `${config.imgBase}/card-imgs/${id}.jpg`;
    return `${config.imgBase}/card-thumbs/${tier}/${id}.webp`;
}
