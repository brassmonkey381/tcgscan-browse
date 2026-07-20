/**
 * Saved searches — star a search (query text + facet selection + sort) to pin it as a
 * one-tap chip under the search box. Persistence is best-effort per platform:
 *   · web    — localStorage (per browser, survives reloads)
 *   · native — module memory (session-sticky, like browseState; resets on app relaunch)
 * The kit owns storage so every consumer surface (browse page, binder card picker) shares
 * the same list with zero app wiring.
 */
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
export declare function listSavedSearches(): SavedSearch[];
/** Two saves are "the same search" when query + facets + sort all match. */
export declare function sameSearch(a: SavedSearch, b: SavedSearch): boolean;
export declare function isSearchSaved(s: SavedSearch): boolean;
/** Toggle: saves the search, or removes it if an identical one is already saved. */
export declare function toggleSavedSearch(s: SavedSearch): void;
export declare function removeSavedSearch(s: SavedSearch): void;
/** Subscribe to list changes (any surface saving updates every mounted browser). */
export declare function subscribeSavedSearches(listener: () => void): () => void;
