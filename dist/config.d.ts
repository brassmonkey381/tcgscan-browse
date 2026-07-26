/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */
import type { CardLanguage, RawCatalog } from './catalog';
import { type ManifestCache } from './images';
/**
 * App-supplied catalog loader — the seam for a GATED/ENCRYPTED catalog (see
 * docs/DATA-PROTECTION-PLAN.md). When set, the kit calls this instead of fetching the public
 * `catalog.json`; the app owns auth + decryption + decoding and returns the parsed `RawCatalog`.
 * Report download progress via `onProgress` so the load bar still animates. Omit for the default
 * public-bucket fetch (back-compat).
 */
export type CatalogSource = (onProgress?: (received: number, total: number) => void) => Promise<RawCatalog>;
/**
 * App-supplied persistence for the shared EN/JP preference (see `language.ts`). The kit has no
 * storage and no auth, so an app that wants the choice to survive a reload (or follow a signed-in
 * collector across devices) supplies these. Both are optional and both must FAIL SOFT — the kit
 * swallows throws and falls back to a session-only preference.
 */
export interface LanguageStore {
    /** Read the stored preference once at startup. Return null/undefined for "nothing stored". */
    load?: () => Promise<CardLanguage[] | null | undefined>;
    /** Persist a change. Fire-and-forget: the kit does not await it or surface failures. */
    save?: (langs: CardLanguage[]) => void;
}
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
    /**
     * Affiliate deep-link TEMPLATE for outbound TCGPlayer links (productUrl / setShopUrl). A tracking
     * URL with a `{url}` token where the URL-ENCODED destination goes, e.g.
     * `https://partner.tcgplayer.com/c/PUB/AD/CAMP?subId1=michi&u={url}`. Sub-IDs (per app / placement)
     * live in the template, owned by the app. Omit/empty → links stay raw tcgplayer.com URLs (no
     * affiliate wrapping), so unconfigured builds are unchanged.
     */
    affiliateDeeplink?: string;
    /**
     * eBay Partner Network campaign id for outbound "Find on eBay" search links. Omit/empty →
     * `ebaySearchUrl` returns '' and callers hide eBay links, so unconfigured builds show none.
     */
    ebayCampaignId?: string;
    /** EPN customid (sub-id) stamped on eBay links for per-surface attribution, e.g. 'michi-recent'. */
    ebayCustomId?: string;
    /**
     * Persistence for the shared EN/JP printing-language preference. Omit and the choice is
     * session-only (still shared across every surface, just not remembered).
     */
    languageStore?: LanguageStore;
}
/** Set the data-server origins. Call once from the app before any browse use. */
export declare function configureBrowse(next: BrowseConfig): void;
/** The app-supplied gated catalog loader, or null for the default public fetch. */
export declare function getCatalogSource(): CatalogSource | null;
/** The app-supplied persistence for the EN/JP preference, or null for session-only. */
export declare function getLanguageStore(): LanguageStore | null;
export declare function getBrowseUrl(): string;
export declare function getImgBase(): string;
export declare function getApiUrl(): string;
export declare function getApiKey(): string;
/** Base URL of the on-device color blob dir; defaults to `${browseUrl}/color`. */
export declare function getColorUrl(): string;
/**
 * Resolve a raw catalog image path to a fully-usable image URL. Absolute URLs
 * (`http(s)://…`) pass through untouched; site-root-relative paths get the
 * imgBase prepended so an origin swap stays centralized here.
 */
export declare function resolveImageUrl(path: string): string;
/**
 * Wrap a raw tcgplayer.com destination in the configured affiliate deep-link, or return it
 * unchanged when no template is set. The template's `{url}` token receives the URL-ENCODED
 * destination; a template without `{url}` gets the encoded destination appended (bare `?u=` style).
 */
export declare function affiliateUrl(destination: string): string;
/**
 * TCGPlayer product page for a card — a pure function of its id (verified 100% of
 * the catalog). Stored per-card in the old fat catalog; derive it instead. Wrapped in the
 * configured affiliate deep-link when one is set (see affiliateUrl / configureBrowse).
 */
export declare function productUrl(id: string): string;
/**
 * A tracked eBay Partner Network search deep link for `query`, scoped to the Pokémon TCG category,
 * using the configured campaign id + customid (see configureBrowse). Returns '' when no campaign id
 * is configured, so callers hide eBay links on unconfigured builds. `mkevt=1` + `mkcid`/`mkrid` are
 * what make EPN attribution fire — confirmed against EPN's link tool for the US marketplace.
 */
export declare function ebaySearchUrl(query: string): string;
/** eBay search link for a specific card (name + set + collector number → query). */
export declare function ebayCardSearchUrl(card: {
    name: string;
    setName?: string;
    number?: string;
}): string;
/**
 * TCGPlayer category page for a SET, from the sets table's `url_name`
 * ("ME05 Pitch Black" → …/pokemon/me05-pitch-black). '' when the name is empty.
 *
 * Japanese sets live under a SEPARATE TCGPlayer category — `pokemon-japan` (e.g.
 * …/pokemon-japan/m3-nihil-zero) — so pass the set's `language` to route JP there; anything
 * other than 'ja' (default) uses the English `pokemon` category.
 */
export declare function setShopUrl(urlName: string, language?: CardLanguage): string;
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
