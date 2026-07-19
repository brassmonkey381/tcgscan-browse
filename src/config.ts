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
import { imageManifestReady, manifestUrl, setManifestCache, type ManifestCache } from './images';

/**
 * App-supplied catalog loader — the seam for a GATED/ENCRYPTED catalog (see
 * docs/DATA-PROTECTION-PLAN.md). When set, the kit calls this instead of fetching the public
 * `catalog.json`; the app owns auth + decryption + decoding and returns the parsed `RawCatalog`.
 * Report download progress via `onProgress` so the load bar still animates. Omit for the default
 * public-bucket fetch (back-compat).
 */
export type CatalogSource = (
  onProgress?: (received: number, total: number) => void,
) => Promise<RawCatalog>;

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
   * Base URL of the on-device color blob dir (holding card_colors.bin / _ids.json / _meta.json).
   * Omit → `${browseUrl}/color`. Powers the warm on-device color path (ColorIndex); the server
   * RPC path needs only apiUrl/apiKey.
   */
  colorUrl?: string;
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

const config: Required<Omit<BrowseConfig, 'cache' | 'catalogSource'>> = {
  browseUrl: '/browse',
  imgBase: '',
  apiUrl: '',
  apiKey: '',
  colorUrl: '',
};
let catalogSource: CatalogSource | null = null;

/** Set the data-server origins. Call once from the app before any browse use. */
export function configureBrowse(next: BrowseConfig): void {
  config.browseUrl = next.browseUrl;
  config.imgBase = next.imgBase;
  config.apiUrl = next.apiUrl ?? deriveApiUrl(next.browseUrl);
  config.apiKey = next.apiKey ?? '';
  config.colorUrl = next.colorUrl ?? '';
  catalogSource = next.catalogSource ?? null;
  setManifestCache(next.cache ?? null);
}

/** The app-supplied gated catalog loader, or null for the default public fetch. */
export function getCatalogSource(): CatalogSource | null {
  return catalogSource;
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
/** Base URL of the on-device color blob dir; defaults to `${browseUrl}/color`. */
export function getColorUrl(): string {
  return config.colorUrl || `${config.browseUrl}/color`;
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
 * TCGPlayer category page for a SET, from the sets table's `url_name`
 * ("ME05 Pitch Black" → …/pokemon/me05-pitch-black). '' when the name is empty.
 */
export function setShopUrl(urlName: string): string {
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
 * manifest (hydrateImageManifest). If the manifest is loaded but the card's tier
 * isn't in it, fall back to the card's mirrored full image; a wholly unmirrored
 * card resolves to '' (placeholder) — the TCGPlayer CDN is NOT used (it 403s
 * hotlinked pulls now, and we don't want to lean on it regardless). Only before
 * the manifest has loaded at all (static/offline) do we use the flat
 * convention path.
 */
export function cardThumbUrl(id: string, tier: 245 | 640 | 'full'): string {
  if (!id) return '';
  const hashed = manifestUrl(id, TIER_FIELD[String(tier)]);
  if (hashed) return hashed;
  if (imageManifestReady()) {
    // Tier not mirrored yet: use the card's mirrored FULL image (our bucket serves CORS
    // headers). Wholly unmirrored → '' so consumers show their placeholder instead of
    // firing a doomed request at the TCGPlayer CDN (403 + no CORS).
    return manifestUrl(id, 'image') ?? '';
  }
  // Manifest not loaded yet (static/offline): flat convention path.
  if (tier === 'full') return `${config.imgBase}/card-imgs/${id}.jpg`;
  return `${config.imgBase}/card-thumbs/${tier}/${id}.webp`;
}
