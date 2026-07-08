/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */

import { imageManifestReady, manifestUrl, setManifestCache, type ManifestCache } from './images';

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
}

const config: Required<Omit<BrowseConfig, 'cache'>> = {
  browseUrl: '/browse',
  imgBase: '',
  apiUrl: '',
  apiKey: '',
};

/** Set the data-server origins. Call once from the app before any browse use. */
export function configureBrowse(next: BrowseConfig): void {
  config.browseUrl = next.browseUrl;
  config.imgBase = next.imgBase;
  config.apiUrl = next.apiUrl ?? deriveApiUrl(next.browseUrl);
  config.apiKey = next.apiKey ?? '';
  setManifestCache(next.cache ?? null);
}

/** `https://<ref>.supabase.co/storage/...` -> `https://<ref>.supabase.co/rest/v1`. */
function deriveApiUrl(browseUrl: string): string {
  try {
    return `${new URL(browseUrl).origin}/rest/v1`;
  } catch {
    return '';
  }
}

export function getBrowseUrl(): string {
  return config.browseUrl;
}
export function getImgBase(): string {
  return config.imgBase;
}
export function getApiUrl(): string {
  return config.apiUrl;
}
export function getApiKey(): string {
  return config.apiKey;
}

/**
 * Resolve a raw catalog image path to a fully-usable image URL. Absolute URLs
 * (`http(s)://…`) pass through untouched; site-root-relative paths get the
 * imgBase prepended so an origin swap stays centralized here.
 */
export function resolveImageUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${config.imgBase}${path}`;
}

/** cardThumbUrl tier → the image manifest field it resolves against. */
const TIER_FIELD: Record<string, string> = {
  '245': 'image_small',
  '640': 'image_medium',
  full: 'image',
};

/**
 * TCGPlayer product page for a card — a pure function of its id (verified 100% of
 * the catalog). Stored per-card in the old fat catalog; derive it instead.
 */
export function productUrl(id: string): string {
  return id ? `https://www.tcgplayer.com/product/${id}` : '';
}

/**
 * TCGPlayer CDN image for a card — also a pure `{id}` template (the `<id>_in_NxN.jpg`
 * convention). Used as the fallback for cards not yet mirrored to our bucket, and
 * for any consumer that wants the source image without the manifest. `size` is the
 * square edge in px (TCGPlayer serves `_in_<size>x<size>.jpg`).
 */
export function cdnImageUrl(id: string, size = 1000): string {
  return id ? `https://tcgplayer-cdn.tcgplayer.com/product/${id}_in_${size}x${size}.jpg` : '';
}

/**
 * Image tiers, keyed by a card's stable id — so a card's image resolves WITHOUT the
 * per-card image URLs living in catalog.json:
 *   - 245 → 245px webp (grids / covers; complete for every mirrored card)
 *   - 640 → 640px webp (binder-page / inspection view)
 *   - 'full' → full-size jpg
 * Hosted buckets key images by content hash, so the URL comes from the image
 * manifest (hydrateImageManifest). If the manifest is loaded but the card isn't in
 * it (not yet mirrored), fall back to the id-derivable TCGPlayer CDN image. Only
 * before the manifest has loaded at all (static/offline) do we use the flat
 * convention path.
 */
export function cardThumbUrl(id: string, tier: 245 | 640 | 'full'): string {
  if (!id) return '';
  const hashed = manifestUrl(id, TIER_FIELD[String(tier)]);
  if (hashed) return hashed;
  // Manifest loaded but this card isn't mirrored → the TCGPlayer CDN source.
  if (imageManifestReady()) return cdnImageUrl(id);
  // Manifest not loaded yet (static/offline): flat convention path.
  if (tier === 'full') return `${config.imgBase}/card-imgs/${id}.jpg`;
  return `${config.imgBase}/card-thumbs/${tier}/${id}.webp`;
}
