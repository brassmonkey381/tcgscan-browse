import type { QuerySort, SortDir } from './query';
export interface SavedSearch {
    /** Chip label — the raw query text (or a facet summary when the query is empty). */
    label: string;
    query: string;
    selection: Record<string, string[]>;
    sortSel: {
        field: QuerySort;
        dir: SortDir;
    } | null;
}
/**
 * Load the persisted list through the app-supplied store, once per session. Adopting does NOT
 * write back. Anything already starred THIS session wins over the stored copy, so a star tapped
 * before a slow native read lands is never swallowed by it.
 */
export declare function hydrateSavedSearches(): Promise<void>;
export declare function listSavedSearches(): SavedSearch[];
/** Two saves are "the same search" when query + facets + sort all match. */
export declare function sameSearch(a: SavedSearch, b: SavedSearch): boolean;
export declare function isSearchSaved(s: SavedSearch): boolean;
/** Toggle: saves the search, or removes it if an identical one is already saved. */
export declare function toggleSavedSearch(s: SavedSearch): void;
export declare function removeSavedSearch(s: SavedSearch): void;
/** Subscribe to list changes (any surface saving updates every mounted browser). */
export declare function subscribeSavedSearches(listener: () => void): () => void;
