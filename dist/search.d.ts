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
}
/** True when the app is configured to reach the data server's REST API. */
export declare function serverSearchAvailable(): boolean;
/** Facet chip selection, facet key -> selected values (the kit's FacetSelection shape). */
export type ServerFacetSelection = Record<string, string[]>;
/**
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages); `facets` are exact-match chip selections (AND across facets,
 * OR within). Returns tile-ready cards + their prices + the real total.
 */
export declare function searchCards(parsed: ParsedQuery, { limit, offset, facets, languages, }?: {
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
export declare function searchFacets(parsed: ParsedQuery, facets?: ServerFacetSelection, languages?: CardLanguage[]): Promise<Record<string, string[]>>;
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
