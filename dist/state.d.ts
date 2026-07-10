/**
 * Session-persistent browse state. The CardPicker unmounts its contents when
 * closed, which used to reset the browser to the series root — annoying when
 * one search feeds several pockets ("place, reopen, re-search, place…").
 * CatalogBrowser hydrates from here on mount and writes back on every change,
 * so reopening the picker lands exactly where you left off. Module-level (not
 * persisted to disk): a fresh app load starts clean.
 */
import type { CatalogCard } from './catalog';
import type { QuerySort, SortDir } from './query';
export interface BrowseState {
    cardQuery: string;
    seriesId: string | null;
    setId: string | null;
    /** Facet chip selection: facet key -> selected values. */
    selection: Record<string, string[]>;
    /** Sort chosen via the UI sort control; null follows the search box's `sort:` (or relevance). */
    sortSel: {
        field: QuerySort;
        dir: SortDir;
    } | null;
    /** The source card(s) a similarity search was run on: their ids + a short label. */
    similarTo: {
        ids: string[];
        name: string;
    } | null;
    similarCards: CatalogCard[];
}
export declare const browseState: BrowseState;
/**
 * Cross-surface browse commands — lets another component on the same screen (e.g. the
 * RecentProducts feed) drive a mounted CatalogBrowser: "show cards similar to X" or
 * "open X's set". CatalogBrowser subscribes; callers use `sendBrowseCommand`.
 *
 * A command sent while nothing is subscribed (the browser is collapsed/unmounted) is
 * held as a single pending command and delivered the moment the next browser subscribes
 * — so the app can expand the browser and the command still lands.
 */
export type BrowseCommand = {
    type: 'similar';
    cardId: string;
} | {
    type: 'viewSet';
    cardId: string;
}
/** Find cards similar to ALL of these (average embedding) — e.g. a binder multi-selection. */
 | {
    type: 'similarMany';
    cardIds: string[];
};
/** Deliver a command to the mounted browser(s), or hold it for the next subscriber. */
export declare function sendBrowseCommand(cmd: BrowseCommand): void;
/** Subscribe a browser to incoming commands; flushes any pending command immediately. */
export declare function subscribeBrowseCommand(listener: (cmd: BrowseCommand) => void): () => void;
