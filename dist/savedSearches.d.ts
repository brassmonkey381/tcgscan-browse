import type { QuerySort, SortDir } from './query';
export interface SavedSearch {
    /** Chip label — the raw query text (or where it was saved, when the query is empty). */
    label: string;
    query: string;
    selection: Record<string, string[]>;
    sortSel: {
        field: QuerySort;
        dir: SortDir;
    } | null;
    /**
     * WHERE the search was saved — the same drill-down the share link serializes (writeUrlState's
     * sr/st). Without these a facets-only save was unreplayable: the facet bar only exists at a card
     * level, so applying one from the front door set filters nothing could show, act on, or clear,
     * and the same chip silently re-filtered whatever OTHER set you happened to be in.
     * Absent on entries saved before this shipped, which read as "no drill-down" and behave as they
     * always did.
     */
    seriesId?: string | null;
    setId?: string | null;
}
/**
 * Load the persisted list through the app-supplied store, once per session.
 *
 * FAILURE IS NOT EMPTINESS. A read that throws leaves the stored list UNKNOWN, so the latch is
 * kept clear and the next mounted browser tries again; treating a fault as "nothing saved" is
 * what let one bad cold read wipe a device permanently, since the next star then wrote an empty
 * list over the real one.
 *
 * Anything starred THIS session wins over the stored copy and is never swallowed by a slow read;
 * once the merge is done, the store is brought back up to date (including any write persist()
 * deferred while the read was outstanding).
 */
export declare function hydrateSavedSearches(): Promise<void>;
export declare function listSavedSearches(): SavedSearch[];
/** Two saves are "the same search" when query + facets + sort all match. */
export declare function sameSearch(a: SavedSearch, b: SavedSearch): boolean;
export declare function isSearchSaved(s: SavedSearch): boolean;
/**
 * Toggle: saves the search, or removes it if an identical one is already saved.
 *
 * Un-starring removes EVERY match, not the first: users who hit the old identity bug have
 * duplicate entries on disk, and removing one at a time left an identical chip behind that looked
 * like the star had failed.
 */
export declare function toggleSavedSearch(s: SavedSearch): void;
export declare function removeSavedSearch(s: SavedSearch): void;
/** Subscribe to list changes (any surface saving updates every mounted browser). */
export declare function subscribeSavedSearches(listener: () => void): () => void;
