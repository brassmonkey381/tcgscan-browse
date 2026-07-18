import { type CatalogSeries, type CatalogSet } from './catalog';
/** The subset of the catalog surface the drill-down needs (Catalog satisfies this). */
export interface TaxonomySource {
    listSeries(): CatalogSeries[];
    listSets(seriesId: string): CatalogSet[];
    getSeries(seriesId: string): CatalogSeries | undefined;
    getSet(setId: string): CatalogSet | undefined;
    /** Total browse card count (for the search placeholder), when known. */
    readonly cardCount?: number;
}
/** Load-once taxonomy (browse/taxonomy.json). Rejects propagate; a later call retries. */
export declare function loadTaxonomy(): Promise<TaxonomySource>;
/**
 * React hook: the taxonomy when `enabled` (cold mode), null while loading / when disabled.
 * Fail-soft: on fetch failure it stays null (the browser then shows the type-to-search idle).
 */
export declare function useTaxonomy(enabled: boolean): TaxonomySource | null;
