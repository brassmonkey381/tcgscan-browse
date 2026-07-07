/** Real-world size class of a card (drives its pocket footprint in binder UIs). */
export type CardKind = 'standard' | 'jumbo' | 'vunion';
/** A single card from the catalog. `id` is the catalog's stable card id (string). */
export interface CatalogCard {
    id: string;
    name: string;
    number: string;
    rarity: string;
    cardType: string[];
    setId: string;
    setName: string;
    setCode: string;
    seriesId: string;
    releaseDate: string;
    image: string;
    kind: CardKind;
    illustrator: string;
    types: string[];
    stage: string;
    imageSmall?: string;
    imageMedium?: string;
}
/**
 * A V-UNION set: four 1×1 catalog pieces that tile a 2×2 block, in
 * [topLeft, topRight, bottomLeft, bottomRight] order.
 */
export interface VUnionGroup {
    base: string;
    label: string;
    pieces: [string, string, string, string];
}
export interface CatalogSet {
    id: string;
    name: string;
    code: string;
    seriesId: string;
    cardCount: number;
    coverUri?: string;
    releaseDate: string;
    lastPrinted: string;
}
export interface CatalogSeries {
    id: string;
    name: string;
    setIds: string[];
    cardCount: number;
    coverUri?: string;
    releaseDate: string;
    firstDate: string;
}
export interface Catalog {
    listSeries(): CatalogSeries[];
    getSeries(seriesId: string): CatalogSeries | undefined;
    listSets(seriesId: string): CatalogSet[];
    getSet(setId: string): CatalogSet | undefined;
    listCards(setId: string): CatalogCard[];
    getCard(cardId: string): CatalogCard | undefined;
    /** Every card (stable order) — for structured queries that scan the corpus. */
    listAll(): CatalogCard[];
    /** Every jumbo (oversized, 2×2) card in the catalog. */
    listJumbo(): CatalogCard[];
    /** The V-UNION groups (each four 1×1 pieces tiling a 2×2). */
    vunionGroups(): VUnionGroup[];
    search(query: string, limit?: number): CatalogCard[];
    searchSeries(query: string, limit?: number): CatalogSeries[];
    searchSets(query: string, limit?: number): CatalogSet[];
    readonly cardCount: number;
}
export interface RawCard {
    id: string;
    name: string;
    number?: string;
    rarity?: string;
    card_type?: string[];
    set_id?: number | string;
    set_name?: string;
    set_code?: string;
    series?: string;
    release_date?: string;
    image?: string;
    kind?: string;
    illustrator?: string;
    types?: string[];
    stage?: string;
    image_small?: string;
    image_medium?: string;
}
export interface RawSet {
    id: number | string;
    name: string;
    code?: string;
    series?: string;
    card_count?: number;
    logo?: string;
    symbol?: string;
}
export interface RawSeries {
    name: string;
    set_ids: (number | string)[];
    card_count?: number;
    logo?: string;
}
export interface RawVUnionGroup {
    base?: string;
    label?: string;
    pieces?: string[];
}
export interface RawCatalog {
    cards: Record<string, RawCard>;
    sets: Record<string, RawSet>;
    series: Record<string, RawSeries>;
    vunionGroups?: RawVUnionGroup[];
}
/** yyyy-mm-dd -> "Mar 2022" (or "" for empty). */
export declare function formatSetDate(iso: string): string;
/** A series' active-years label from its first/last set, e.g. "2016–2018" or "2016". */
export declare function seriesDateRange(s: {
    firstDate: string;
    releaseDate: string;
}): string;
/**
 * Subscribe to catalog-loaded notifications. The callback fires once, when the shared
 * catalog finishes loading (i.e. when `getLoadedCatalog()` flips from null to the catalog).
 * Lets components reactively pick up the catalog *without* forcing the fetch themselves.
 * Returns an unsubscribe function.
 */
export declare function subscribeCatalog(callback: () => void): () => void;
/**
 * Shared, load-once catalog: the fetch + parse happens exactly once app-wide
 * (module-level promise cache), regardless of how many callers await it.
 */
export declare function loadCatalog(): Promise<Catalog>;
/** Alias of {@link loadCatalog} — the shared, load-once catalog promise. */
export declare function getCatalog(): Promise<Catalog>;
/**
 * Fire-and-forget, low-priority warm of the shared catalog. Kicks off the load-once
 * fetch/parse without making any caller await it, and swallows errors (on failure
 * `loadCatalog` already clears its cache so a later mount retries).
 */
export declare function prefetchCatalog(): void;
/**
 * Synchronous access to the catalog *iff* it has already resolved, else `null`.
 * Lets render-path code read the catalog without awaiting — callers must handle
 * the `null` (still-loading) case with a fallback. Does NOT kick off a load.
 */
export declare function getLoadedCatalog(): Catalog | null;
