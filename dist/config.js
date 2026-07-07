/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */
import { manifestUrl, setManifestCache } from './images';
const config = {
    browseUrl: '/browse',
    imgBase: '',
    apiUrl: '',
    apiKey: '',
};
/** Set the data-server origins. Call once from the app before any browse use. */
export function configureBrowse(next) {
    config.browseUrl = next.browseUrl;
    config.imgBase = next.imgBase;
    config.apiUrl = next.apiUrl ?? deriveApiUrl(next.browseUrl);
    config.apiKey = next.apiKey ?? '';
    setManifestCache(next.cache ?? null);
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
 * Image tiers, keyed by a card's stable id — so a card's image can be shown
 * WITHOUT loading the ~25MB catalog.json first:
 *   - 245 → 245px webp (grids / covers; complete for every card)
 *   - 640 → 640px webp (binder-page view)
 *   - 'full' → full-size jpg (the safe fallback if a webp 404s)
 * Hosted buckets key images by content hash, so the URL is resolved through the
 * image manifest (hydrateImageManifest) when it's loaded; otherwise it falls
 * back to the flat `<id>` convention path — correct for local static assets and
 * for cards not yet in the manifest. Requires imgBase at the bucket's public root.
 */
export function cardThumbUrl(id, tier) {
    if (!id)
        return '';
    const hashed = manifestUrl(id, TIER_FIELD[String(tier)]);
    if (hashed)
        return hashed;
    if (tier === 'full')
        return `${config.imgBase}/card-imgs/${id}.jpg`;
    return `${config.imgBase}/card-thumbs/${tier}/${id}.webp`;
}
