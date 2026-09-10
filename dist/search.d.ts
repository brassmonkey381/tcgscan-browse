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
}
export declare function freeThemeDepth(): Promise<number>;
/** True when the app is configured to reach the data server's REST API. */
export declare function serverSearchAvailable(): boolean;
/** Facet chip selection, facet key -> selected values (the kit's FacetSelection shape). */
export type ServerFacetSelection = Record<string, string[]>;
/**
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages); `facets` are exact-match chip selections (AND across facets,
 * OR within). Returns tile-ready cards + their prices + the real total.
 */
export declare function searchCards(parsedIn: ParsedQuery, { limit, offset, facets, languages: boundIn, }?: {
    limit?: number;
    offset?: number;
    facets?: ServerFacetSelection;
    languages?: CardLanguage[];
}): Promise<SearchPage>;
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
