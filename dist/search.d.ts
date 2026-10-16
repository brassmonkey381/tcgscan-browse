/**
 * Server-side card search — the data server's `search_cards` RPC (see
 * tcgscan-data/supabase/migrations/20260710_12_search_cards.sql). It reproduces the client
 * `runQuery`/`scoreCard`/`sortCards` semantics EXACTLY, so the COLD path (catalog not yet in
 * memory) returns the same result set + order as the warm on-device path — the browser can
 * search in ~one round-trip while the ~28k-card catalog is still downloading/parsing.
 *
 * The client keeps `parseQuery` as the single grammar source of truth and sends STRUCTURED
 * params; no grammar is reimplemented here. Rows come back tile-ready (mapped to CatalogCard,
 * with the price carried separately), so a hit renders + opens its action sheet WITHOUT the
 * card being in the in-memory catalog. Fails soft (empty) — server search is an enhancement.
 *
 * POKEMON'S THEME TOOLBAR (frame, type chips, grouping) rides on `search_cards` itself: see
 * `ThemeToolbar` below. It adds `p_fields` entries to a themed query only, and nothing at its
 * defaults, so every other body is exactly what it was.
 *
 * A SECONDARY GAME (Lorcana, One Piece) has no `search_cards`; its themed queries go to
 * `theme_search` / `theme_facets` (tcgscan-data migration 79) through `searchThemes` /
 * `themeFacets` below, which answer ranked ids only. `mergeThemeHits` maps them onto the game's
 * own public catalog rows, and the rest of the query runs on the device over those.
 */
import { type CardLanguage, type CatalogCard } from './catalog';
import type { ParsedQuery } from './query';
/** One page of server results: tile-ready cards, their prices (by id), and the true total. */
export interface SearchPage {
    cards: CatalogCard[];
    /** Headline value per hit id (RPC `cur`), so cold-mode tiles/sort show prices without the
     *  price summary loaded. */
    priceById: Record<string, number>;
    /** Real match count for the whole query (RPC `total_count` window), for the results header. */
    total: number;
    /**
     * THE METER. True when a themed query came back depth-limited: the server kept the true total
     * but handed over only the first few rows (an anonymous caller's `free_theme_depth`). The
     * caller shows "top N, +M more" and does not page — there is nothing more to fetch this way.
     * Never true on the host's paid path, and never on an ordinary word search.
     */
    clamped: boolean;
    /**
     * A clamped page that should NOT have been: the host's paid endpoint BROKE, so the metered
     * direct path answered. The UI says "temporarily limited" rather than selling an upgrade to
     * someone who already pays — otherwise the first symptom of a broken endpoint is paying members
     * quietly losing a feature.
     *
     * Broke, not refused. A 401 or 403 is the endpoint working correctly and saying the caller does
     * not hold the feature, which is the ordinary free case; only a 5xx, a missing function or a
     * network failure sets this. See `proxyBroke` in searchCards.
     */
    degraded: boolean;
    /**
     * THE SERVER DID NOT ANSWER, as opposed to answering "nothing matches".
     *
     * The page is still empty — everything here fails soft — but an empty page used to be the only
     * signal, so a 500 rendered as a confident "No cards match". On 2026-09-12 the data project's
     * `search_cards` hit its statement timeout on every query without a free-text word, and for as
     * long as that lasted `type:fire` told every user there were no Fire cards. Nobody could tell an
     * outage from a bad query, including the people debugging it. Set on a non-OK response or a
     * thrown fetch; never on a genuine zero-row answer, and never when server search is simply not
     * configured or the language bound is contradictory, since those are answers too.
     */
    failed: boolean;
}
/**
 * Internal: forget every server-search cache (resetBrowseData). They are keyed by card and set id,
 * and ids are one namespace across games, but a set's card list and a card's detail come from the
 * configured api, which the host has just changed.
 */
export declare function _resetSearchCaches(): void;
export declare function freeThemeDepth(): Promise<number>;
/** True when the app is configured to reach the data server's REST API. */
export declare function serverSearchAvailable(): boolean;
/** Facet chip selection, facet key -> selected values (the kit's FacetSelection shape). */
export type ServerFacetSelection = Record<string, string[]>;
/**
 * THE POKEMON THEME TOOLBAR (CatalogBrowser's `themeTools`), as `search_cards` takes it: extra
 * `p_fields` entries that only a THEMED query carries (tcgscan-data migration 81 reads them; a
 * server before it, and `search_facets`, answer them with `else true`, i.e. ignore them).
 *   · `{key:'frame', value:'full'|'window'}` keeps full art or windowed art only;
 *   · `{key:'tgroup', value:<group key>}` once per type chip, OR-ed (an energy type, Trainer, Energy);
 *   · `{key:'group', value:'type'}` puts a relevance result in registry type order. The server
 *     honours it for an UNCLAMPED (paid) caller only; a free caller gets the best N by rank, which
 *     the browser groups on the device.
 * The defaults (all art, no chips, ungrouped) add nothing, so such a body is byte-identical to one
 * sent without a toolbar.
 */
export interface ThemeToolbar {
    frame?: ThemeFrame;
    types?: readonly string[];
    group?: boolean;
}
/** The `p_fields` entries a toolbar adds, in a fixed order (frame, chips, grouping). */
export declare function themeToolbarFields(t?: ThemeToolbar): {
    key: string;
    value: string;
}[];
/**
 * A Pokemon card's type group as the device can tell it: its first energy type, else Trainer or
 * Energy from its card type, else Other. This mirrors tcgscan-data's `_pokemon_type_of`, except
 * that the server reads `card_type_b`, which the slim catalog does not ship, so a few edge cards
 * may land in a different group than the server's own order puts them. A row that carries the
 * server's `type_group` (a later migration; 81 does not return it) uses that instead. `known` (the registry's group keys) maps
 * an energy type the registry does not list to Other, as the server does.
 */
export declare function localTypeGroup(card: Pick<CatalogCard, 'types' | 'cardType'>, known?: readonly string[]): string;
/**
 * Stable-sort rows by a registry's group order: rank order holds inside each group, and a group not
 * in the list sorts last. Shared by both theme paths (mergeThemeHits for a secondary game, and a
 * Pokemon themed result in CatalogBrowser).
 */
export declare function groupByOrder<T>(rows: readonly T[], order: readonly string[], groupOf: (row: T) => string): T[];
/**
 * A search endpoint named per call, for a host that must search a game OTHER than the one the kit
 * is configured for (a card of another game, edited while this one is active) without switching
 * the whole kit, which would reset every per-game cache. `url` is the PostgREST root that serves
 * `rpc/search_cards`; `key` its publishable key.
 */
export interface SearchApi {
    url: string;
    key: string;
}
/**
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages); `facets` are exact-match chip selections (AND across facets,
 * OR within). Returns tile-ready cards + their prices + the real total.
 *
 * `api` searches that endpoint instead of the configured one. Nothing else about the configured
 * game applies to it: the host's themed-search proxy and the free theme depth belong to the
 * configured game, so neither is used, and a themed query is judged by its row count alone.
 */
export declare function searchCards(parsedIn: ParsedQuery, { limit, offset, facets, languages: boundIn, api, toolbar, }?: {
    limit?: number;
    offset?: number;
    facets?: ServerFacetSelection;
    languages?: CardLanguage[];
    api?: SearchApi;
    /** The Pokemon theme toolbar; appended to a THEMED query's p_fields only (themeToolbarFields). */
    toolbar?: ThemeToolbar;
}): Promise<SearchPage>;
/** Which artwork a theme search keeps: all of it, full art only, or windowed only (`p_frame`). */
export type ThemeFrame = 'all' | 'full' | 'window';
/**
 * A SECONDARY GAME'S THEMED QUERY, in the shape `theme_search` takes it. The game's cards live in
 * its own public catalog.json, which carries no captions or tags, so only what needs the artwork
 * goes to the server:
 * - `themes`: the theme field values exactly as parseQuery writes them (`forest`, `character:elsa`,
 *   `-night`), the same values `search_cards` takes;
 * - `words`: the bare words, AND-ed over each card's public text, so the meter counts them too;
 * - `frame`, `types`, `group`: the theme toolbar (full art or windowed, type chips OR-ed within,
 *   pages grouped by type).
 *
 * Everything else in the query (rarity:, set:, price, have:, comparisons, facet chips, an explicit
 * sort) is answered on the device over the merged rows: query.ts `withoutTheme` + `filterCards`.
 */
export interface ThemeQuery {
    themes: string[];
    words: string[];
    frame?: ThemeFrame;
    types?: string[];
    group?: boolean;
}
/**
 * One ranked theme hit: an id and public rank facts, nothing else. The RPC returns no caption,
 * tag, scene score or probability, and this shape must never grow one (the data project's data
 * boundary: those stay in its private `card_themes`).
 */
export interface ThemeHit {
    id: string;
    /** 0 = the game's showcase tier, 1 = other full art, 2 = windowed. */
    artBand: number;
    fullArt: boolean;
    /** The registry's type group key ('Amber', 'Dual ink', 'Red', 'Multicolour', 'DON!!', …). */
    typeGroup: string;
}
/**
 * One page of `theme_search`: the hits in server order (the order IS the ranking) and the true
 * total. `clamped`, `degraded` and `failed` mean exactly what they mean on SearchPage. `total`
 * counts theme + words + frame + type matches, before any device-only filter, and includes ids
 * this device's catalog may lack.
 */
export interface ThemePage {
    hits: ThemeHit[];
    total: number;
    clamped: boolean;
    degraded: boolean;
    failed: boolean;
}
/** Chip counts for a theme query: `frame` by 'full' / 'window', `type` by type group key. */
export interface ThemeFacetCounts {
    frame: Record<string, number>;
    type: Record<string, number>;
}
/**
 * Rank a SECONDARY GAME'S theme query on the data project's `theme_search`, one page at a time.
 * The answer is ids in rank order plus the true total; map them onto the game's catalog rows with
 * `mergeThemeHits`. A game the data project has not enabled answers an empty page, like a query
 * that matches nothing.
 *
 * The paid path is searchCards' to the letter: a host proxy and a token take the body tagged
 * `rpc: 'theme_search'` (the host's endpoint forwards it unmetered); a 401/403 falls through to the
 * direct, metered call, and anything else that goes wrong there sets `degraded` on a clamped page.
 * A free (clamped) caller gets the top `free_theme_depth` hits by rank and the true total; the
 * server ignores `group` for it, so `mergeThemeHits` groups those few rows on the device.
 *
 * Fails soft: an empty page when server search is not configured, there is no game or no theme
 * term, or the language bound is contradictory (`languages: []`); `failed` when the server did not
 * answer.
 */
export declare function searchThemes(game: string, q: ThemeQuery, { limit, offset, languages }?: {
    limit?: number;
    offset?: number;
    languages?: CardLanguage[];
}): Promise<ThemePage>;
/**
 * Chip counts for a secondary game's theme query (`theme_facets`), exclude-self: the frame counts
 * honour the type chips and ignore the frame; the type counts honour the frame and ignore the type
 * chips. A dual-ink or multicolour card counts under its group AND under each member, which is why
 * this cannot be counted from a page of ThemeHits on the device.
 *
 * Always the direct call: these are counts, not cards, so nothing here is metered by depth and the
 * paid path has nothing to add. `null` when the server did not answer (or is not configured): the
 * caller hides the counts and keeps the chips.
 */
export declare function themeFacets(game: string, q: ThemeQuery, { languages }?: {
    languages?: CardLanguage[];
}): Promise<ThemeFacetCounts | null>;
/**
 * THE MERGE: `theme_search`'s ranked ids onto the device's own catalog rows, in server order.
 *
 * The server answers ids and rank facts; the tile, the price and every other filter come from the
 * game's public catalog.json, so a hit renders exactly like a browsed card. Each kept row is a copy
 * carrying the hit's `themeFullArt` and `themeGroup`. An id the catalog does not have is DROPPED (a
 * card published after this bundle, or another game's id, which the server never sends but the
 * merge does not take on trust), so the list can only show cards this device can render. `keep` is
 * the caller's pre-filter (the language bound). A repeated id (pages that overlapped while the data
 * changed) keeps its first, best-ranked place.
 *
 * `groupOrder` (the registry's type group keys, in display order) groups the rows HERE, with a
 * stable sort: rank order holds inside each group, and a group not in the list sorts last. Pass it
 * for a CLAMPED page with grouping on. The server ignores `group` for a free caller and returns the
 * best N by rank, never the best N of the first group; a paid page already arrives grouped.
 *
 * Pure (no fetch, no state), so a host or a check script can run it on fixtures.
 */
export declare function mergeThemeHits<T extends CatalogCard>(hits: readonly ThemeHit[], getCard: (id: string) => T | undefined, { keep, groupOrder }?: {
    keep?: (card: T) => boolean;
    groupOrder?: readonly string[];
}): T[];
/**
 * A set's browse-visible cards, straight from PostgREST (no catalog needed) — powers the
 * cold-mode Series → Set → Card drill-down. Sorted like the warm listCards (collector number,
 * then name); cached per set for the session. Fails soft (empty).
 */
export declare function fetchSetCards(setId: string, languages?: CardLanguage[]): Promise<CatalogCard[]>;
/**
 * Resolve specific card ids to tile-ready cards without the catalog (cold-mode similar
 * results, multi-select thumbs, …). Order follows the input ids. Fails soft (drops misses).
 * Cached per id for the session; concurrent callers coalesce onto one request, so the
 * browser's independent cold consumers (occupant effect, command handler, similar results)
 * share a single round-trip per id.
 */
export declare function fetchCardsByIds(ids: string[]): Promise<CatalogCard[]>;
/**
 * Facet values (+counts) for the query's match set — restores the facet bar in COLD mode.
 * Exclude-self per facet (server-side), mirroring the warm facetOptions. Returns facet key →
 * values in server order (the kit re-orders for display). Fails soft (empty map).
 */
export declare function searchFacets(parsedIn: ParsedQuery, facets?: ServerFacetSelection, boundIn?: CardLanguage[]): Promise<Record<string, string[]>>;
/**
 * `searchFacets` plus the POKEMON THEME TOOLBAR'S CHIP COUNTS, from the same single call.
 *
 * With a `toolbar`, a themed query's body carries its fields (themeToolbarFields), and any rows the
 * server answers under facet `frame` ('full' / 'window') or `tgroup` (a type group key) become
 * `counts`, meant exclude-self as theme_facets' are (frame counts ignore the frame, type counts
 * ignore the chips). Those rows are not facet chips, so they never reach `facets`. Today's
 * `search_facets` ignores the toolbar keys and answers no such rows: `counts` is then null and the
 * toolbar shows its chips without numbers. Without a toolbar the body is exactly searchFacets'.
 */
export declare function searchFacetsWithCounts(parsedIn: ParsedQuery, facets?: ServerFacetSelection, boundIn?: CardLanguage[], toolbar?: ThemeToolbar): Promise<{
    facets: Record<string, string[]>;
    counts: ThemeFacetCounts | null;
}>;
/**
 * Every card in the recent release window (release_date >= cutoff, upcoming included),
 * newest first — powers the catalog-FREE Recent & Upcoming feed. Fails soft ([]).
 */
/** Per-card heavy fields NOT shipped in the slim catalog — fetched on demand (rpc/card_detail,
 *  tcgscan-data migration 32). Today: the evolution line (only the card action sheet reads it). */
export interface CardDetail {
    evolvesFrom: string;
    evolutionLine: string[];
}
/**
 * Resolve per-card detail fields by id (batched ≤50 per the RPC's cap, cached forever — the
 * fields are immutable per printing). Fails soft to whatever the cache already holds.
 */
export declare function fetchCardDetail(ids: string[]): Promise<Record<string, CardDetail>>;
export declare function fetchRecentWindow(cutoff: string, languages?: CardLanguage[], limit?: number): Promise<CatalogCard[]>;
/** Set metadata for feed tiles (names, counts, official logos). The table is small (~200 rows). */
export interface SetMeta {
    id: string;
    name: string;
    series: string;
    cardCount: number;
    logoUrl: string;
}
export declare function fetchSetMeta(): Promise<Map<string, SetMeta>>;
