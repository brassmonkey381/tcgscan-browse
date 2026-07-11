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
import type { CatalogCard } from './catalog';
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
/**
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages). Returns tile-ready cards + their prices + the real total.
 */
export declare function searchCards(parsed: ParsedQuery, { limit, offset }?: {
    limit?: number;
    offset?: number;
}): Promise<SearchPage>;
