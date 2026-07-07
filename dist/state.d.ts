/**
 * Session-persistent browse state. The CardPicker unmounts its contents when
 * closed, which used to reset the browser to the series root — annoying when
 * one search feeds several pockets ("place, reopen, re-search, place…").
 * CatalogBrowser hydrates from here on mount and writes back on every change,
 * so reopening the picker lands exactly where you left off. Module-level (not
 * persisted to disk): a fresh app load starts clean.
 */
import type { CatalogCard } from './catalog';
export interface BrowseState {
    cardQuery: string;
    seriesId: string | null;
    setId: string | null;
    /** Facet chip selection: facet key -> selected values. */
    selection: Record<string, string[]>;
    similarTo: {
        id: string;
        name: string;
    } | null;
    similarCards: CatalogCard[];
}
export declare const browseState: BrowseState;
