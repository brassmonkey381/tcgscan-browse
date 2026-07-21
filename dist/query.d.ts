/**
 * Search-box query grammar for the card browser — one box for almost everything.
 *
 *     charizard artist:arita rarity:"holo rare" set:base series:base type:fire
 *     stage:basic year:1999 num:4 hp>200 stage>1 date>2023 >$100 <$500 sort:value
 *
 *  - bare words        AND-ed, case-insensitive substring match on the card name
 *  - key:value         field filters (quote multi-word values); substring match
 *  - key OP value      numeric/date comparisons — hp>200, stage>1, date>=06-2024
 *  - >$N / <$N         price bounds (also >=$N / <=$N, and value>N without the $)
 *  - sort:field[:dir]  result ordering (default: name relevance); dir = asc | desc
 *
 * EXTRACTION-READY (shared-browse): pure functions, no app imports — the card
 * shape and the price lookup are injected. This module is the seam that will
 * move to the shared tcgscan-browse package consumed by both michi-maker and
 * tcgscan-app, so keep it dependency-free.
 */
/** The card fields the grammar can address. Both apps' catalog cards satisfy this. */
export interface QueryableCard {
    id: string;
    name: string;
    number: string;
    rarity: string;
    cardType: string[];
    setName: string;
    seriesId: string;
    releaseDate: string;
    illustrator: string;
    types: string[];
    stage: string;
    /** Printed HP, or null when the card has none / it's unknown. */
    hp: number | null;
    /** Evolution stage, 1-indexed (1 = Basic, 2 = Stage 1, …); -1 when unknown. */
    evolutionStage: number;
}
/** The attribute a `sort:` orders by. Direction is carried separately (see SortDir). */
export type QuerySort = 'relevance' | 'value' | 'date' | 'name' | 'hp' | 'stage';
export type SortDir = 'asc' | 'desc';
/** A numeric/date comparison filter — `hp>200`, `stage>1`, `date>=06-2024`. */
export type CompareField = 'hp' | 'stage' | 'date';
export type CompareOp = '>' | '>=' | '<' | '<=' | '=';
export interface Comparison {
    field: CompareField;
    op: CompareOp;
    /** Numeric fields: the number as typed. Date field: a normalized yyyy[-mm[-dd]] prefix. */
    value: string;
}
export interface ParsedQuery {
    /** Bare words — every one must appear in the card name. */
    words: string[];
    /** key -> value filters (already lowercased). */
    fields: {
        key: FieldKey;
        value: string;
    }[];
    /** Numeric/date comparison filters (hp / evolution stage / release date). */
    comparisons: Comparison[];
    minPrice: number | null;
    maxPrice: number | null;
    /** Collection filter: true = own it, false = missing it, null = no filter. Evaluated only
     *  when the caller supplies an owned-id set (a warm, signed-in concept); ignored otherwise. */
    owned: boolean | null;
    sort: QuerySort;
    sortDir: SortDir;
    /** True when anything beyond bare name words is present. */
    hasStructure: boolean;
}
export type FieldKey = 'artist' | 'illustrator' | 'rarity' | 'set' | 'series' | 'type' | 'stage' | 'year' | 'num';
/** `rarity:"holo rare"` / `artist:arita` / `hp>200` / `>$100` / bare words — quote-aware. */
export declare function parseQuery(raw: string): ParsedQuery;
/**
 * Relevance score for `card` against the query — 0 rejects, higher ranks earlier.
 * Bare words match ANY field ("arita" finds the illustrator, "sword" finds
 * Sword & Shield cards), every word must land somewhere (AND), and name hits
 * outrank other-field hits so "charizard" still puts Charizards first.
 */
export declare function scoreCard(card: QueryableCard, q: ParsedQuery, priceOf: (id: string) => number, opts?: {
    nameWords?: Set<string>;
    ownedIds?: ReadonlySet<string>;
}): number;
/** Does `card` satisfy the query? (scoreCard > 0.) */
export declare function matchCard(card: QueryableCard, q: ParsedQuery, priceOf: (id: string) => number): boolean;
/**
 * The one-call search: filter + rank + cap. Relevance = score desc (stable
 * within ties); explicit sort:value/newest/name overrides.
 */
export declare function runQuery<T extends QueryableCard>(cards: T[], q: ParsedQuery, priceOf: (id: string) => number, limit?: number, ownedIds?: ReadonlySet<string>): T[];
/** Order results per the query's sort field + direction (relevance = input order). */
export declare function sortCards<T extends QueryableCard>(cards: T[], q: ParsedQuery, priceOf: (id: string) => number): T[];
/**
 * Terse echo of how the query was UNDERSTOOD — shown under the search box.
 * Bare words are attributed to the field they predominantly matched across the
 * results (pass `matched`), so "arita fire >0 <100" echoes as
 *     artist=arita & type=fire & ($0.00 ≤ value ≤ $100.00)
 * A word with mixed/unknowable attribution stays as "word".
 */
export declare function describeQuery(q: ParsedQuery, matched?: QueryableCard[]): string;
/** Placeholder/help line advertising the grammar (shared by both apps' search boxes). */
export declare const QUERY_HINT = "try: charizard hp>200 date>2023 sort:value";
/**
 * The search user manual — data, not UI, so every app renders the same manual
 * in its own components (the "?" help panel).
 */
export interface ManualSection {
    title: string;
    rows: [code: string, description: string][];
}
export declare const QUERY_MANUAL: ManualSection[];
