/**
 * Package configuration — injected by the consuming app, never read from env.
 *
 * Expo inlines EXPO_PUBLIC_* variables in APP source at build time; code inside
 * node_modules can't rely on that. So each app keeps a tiny config shim that
 * reads its env and calls `configureBrowse(...)` once at import time (see the
 * apps' src/lib/catalogConfig.ts). Every fetch in this package reads the config
 * lazily, so configure-at-import is always early enough.
 */
import { _resetCatalog } from './catalog';
import { _bumpGeneration } from './generation';
import { _resetImageManifest, imageManifestReady, imageManifestSettled, manifestUrl, setManifestCache, } from './images';
import { _resetPrices } from './prices';
import { _resetSealed } from './sealed';
import { _resetSearchCaches } from './search';
import { _resetTaxonomy } from './taxonomy';
const config = {
    browseUrl: '/browse',
    imgBase: '',
    apiUrl: '',
    apiKey: '',
    colorUrl: '',
    affiliateDeeplink: '',
    ebayCampaignId: '',
    ebayCustomId: '',
};
/** eBay's "Pokémon TCG" category — scoping a search to it keeps results on cards. */
const EBAY_POKEMON_TCG_CATEGORY = '2536';
const POKEMON_LINE = { tcgplayerCategory: 'pokemon', ebayCategory: EBAY_POKEMON_TCG_CATEGORY };
let productLine = POKEMON_LINE;
let catalogSource = null;
let languageStore = null;
let savedSearchStore = null;
let themedSearch = null;
/** The host's paid themed-search endpoint, or null for the direct, metered path only. */
export function getThemedSearchProxy() {
    return themedSearch;
}
/**
 * FORGET EVERY PER-GAME CACHE, so the next read of each loads from the configured browseUrl and
 * catalogSource. For a host that switches games in place (no page reload): the catalog, its load
 * status, the price summary and per-card prices, the sealed catalog, the taxonomy, the primary
 * image manifest and the server-search caches. User preferences (language, saved searches, the
 * browse state) and the host's registrations (secondary manifests and summaries, the similarity
 * model) are not data and are left alone.
 *
 * Bumps the data generation (generation.ts): a load already in flight will not publish when it
 * lands, and `useBrowseGeneration()` re-renders so the host can remount what holds a catalog in
 * React state. `configureBrowse` calls this on its own when browseUrl or catalogSource changes.
 */
export function resetBrowseData() {
    _bumpGeneration();
    _resetCatalog();
    _resetPrices();
    _resetSealed();
    _resetTaxonomy();
    _resetImageManifest();
    _resetSearchCaches();
}
let configured = false;
/** Set the data-server origins. Call once from the app before any browse use, or again to point
 *  the kit at another game, which resets every per-game cache (see resetBrowseData). */
export function configureBrowse(next) {
    const moved = configured &&
        (next.browseUrl !== config.browseUrl || (next.catalogSource ?? null) !== catalogSource);
    configured = true;
    config.browseUrl = next.browseUrl;
    config.imgBase = next.imgBase;
    config.apiUrl = next.apiUrl ?? deriveApiUrl(next.browseUrl);
    config.apiKey = next.apiKey ?? '';
    config.colorUrl = next.colorUrl ?? '';
    config.affiliateDeeplink = next.affiliateDeeplink ?? '';
    config.ebayCampaignId = next.ebayCampaignId ?? '';
    config.ebayCustomId = next.ebayCustomId ?? '';
    catalogSource = next.catalogSource ?? null;
    languageStore = next.languageStore ?? null;
    savedSearchStore = next.savedSearchStore ?? null;
    themedSearch = next.themedSearch ?? null;
    productLine = { ...POKEMON_LINE, ...(next.productLine ?? {}) };
    setManifestCache(next.cache ?? null);
    if (moved)
        resetBrowseData();
}
/** The app-supplied persistence for starred searches, or null for the platform default. */
export function getSavedSearchStore() {
    return savedSearchStore;
}
/** The app-supplied gated catalog loader, or null for the default public fetch. */
export function getCatalogSource() {
    return catalogSource;
}
/** The app-supplied persistence for the EN/JP preference, or null for session-only. */
export function getLanguageStore() {
    return languageStore;
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
/** Base URL of the on-device color blob dir; defaults to `${browseUrl}/color`. */
export function getColorUrl() {
    return config.colorUrl || `${config.browseUrl}/color`;
}
/**
 * Point the colour features at ONE GAME'S palettes, without touching the rest of the config.
 *
 * For a host that serves one game per page load this never needs calling: the default derives
 * from `browseUrl` and is already right. It exists for a host that browses a SECOND game inside a
 * session configured for the first — michi, whose binder is Pokémon's but whose picker can browse
 * One Piece from its own published catalog. There `browseUrl` stays Pokémon's, so colour search
 * asked Pokémon's blob, got Pokémon ids, and the browser filtered every one of them away against
 * the One Piece catalog: "No color matches", for a game that had just published 6,907 palettes.
 *
 * `configureBrowse` is not the tool for that — it resets the catalog source, the language store,
 * the manifest cache and the product line, all of which belong to the host's primary game. This
 * sets the one field. Pass '' to go back to the default.
 *
 * Cheap to call repeatedly: the colour index is keyed by URL (see color.ts), so switching games
 * back and forth keeps both loaded rather than re-downloading either.
 */
export function setColorUrl(url) {
    config.colorUrl = url;
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
 * Wrap a raw tcgplayer.com destination in the configured affiliate deep-link, or return it
 * unchanged when no template is set. The template's `{url}` token receives the URL-ENCODED
 * destination; a template without `{url}` gets the encoded destination appended (bare `?u=` style).
 */
export function affiliateUrl(destination) {
    const t = config.affiliateDeeplink;
    if (!t || !destination)
        return destination;
    const enc = encodeURIComponent(destination);
    return t.includes('{url}') ? t.replace('{url}', enc) : `${t}${enc}`;
}
/**
 * TCGPlayer product page for a card — a pure function of its id (verified 100% of
 * the catalog). Stored per-card in the old fat catalog; derive it instead. Wrapped in the
 * configured affiliate deep-link when one is set (see affiliateUrl / configureBrowse).
 */
export function productUrl(id) {
    return id ? affiliateUrl(`https://www.tcgplayer.com/product/${id}`) : '';
}
/**
 * A tracked eBay Partner Network search deep link for `query`, scoped to the configured card
 * category (Pokémon TCG unless `productLine` says otherwise; unscoped when that is ''),
 * using the configured campaign id + customid (see configureBrowse). Returns '' when no campaign id
 * is configured, so callers hide eBay links on unconfigured builds. `mkevt=1` + `mkcid`/`mkrid` are
 * what make EPN attribution fire — confirmed against EPN's link tool for the US marketplace.
 */
export function ebaySearchUrl(query) {
    const campid = config.ebayCampaignId;
    const q = query.trim();
    if (!campid || !q)
        return '';
    const parts = [
        `_nkw=${encodeURIComponent(q)}`,
        productLine.ebayCategory ? `_sacat=${productLine.ebayCategory}` : '',
        'mkcid=1',
        'mkrid=711-53200-19255-0',
        'siteid=0',
        `campid=${campid}`,
        config.ebayCustomId ? `customid=${encodeURIComponent(config.ebayCustomId)}` : '',
        'toolid=10001',
        'mkevt=1',
    ].filter(Boolean);
    return `https://www.ebay.com/sch/i.html?${parts.join('&')}`;
}
/** eBay search link for a specific card (name + set + collector number → query). */
export function ebayCardSearchUrl(card) {
    const q = [card.name, card.setName, card.number].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
    return ebaySearchUrl(q);
}
/**
 * TCGPlayer category page for a SET, from the sets table's `url_name`
 * ("ME05 Pitch Black" → …/pokemon/me05-pitch-black). '' when the name is empty.
 *
 * Japanese sets live under a SEPARATE TCGPlayer category — `pokemon-japan` (e.g.
 * …/pokemon-japan/m3-nihil-zero) — so pass the set's `language` to route JP there; anything
 * other than 'ja' (default) uses the English `pokemon` category.
 *
 * Another game (configureBrowse `productLine`) uses its own category for every set.
 */
export function setShopUrl(urlName, language) {
    const slug = urlName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const pokemon = productLine.tcgplayerCategory === POKEMON_LINE.tcgplayerCategory;
    const category = pokemon && language === 'ja' ? 'pokemon-japan' : productLine.tcgplayerCategory;
    return slug
        ? affiliateUrl(`https://www.tcgplayer.com/categories/trading-and-collectible-card-games/${category}/${slug}`)
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
 * hotlinked pulls now, and we don't want to lean on it regardless).
 *
 * Before the manifest resolves we must NOT emit the flat `card-thumbs/<tier>/<id>.webp`
 * convention on a hosted bucket: that layout is retired (images key by content hash), so every
 * such URL 404s and the browser ORB-blocks the JSON error — a wave of failed requests + console
 * spam on every cold paint. So while a hosted manifest is still IN FLIGHT (not settled) we return
 * '' (placeholder) and let consumers repaint when it lands. Only once hydration has SETTLED with no
 * manifest — genuine static/offline mode, where the flat layout is real — do we use the convention.
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
    // Manifest still loading: placeholder now, repaint when it lands (no doomed hosted request).
    if (!imageManifestSettled())
        return '';
    // Settled with no manifest → static/offline, where the flat convention is the real layout.
    if (tier === 'full')
        return `${config.imgBase}/card-imgs/${id}.jpg`;
    return `${config.imgBase}/card-thumbs/${tier}/${id}.webp`;
}
