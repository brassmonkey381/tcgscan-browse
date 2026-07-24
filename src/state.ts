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
import type { SimilarStep } from './similar';

/** Rendered card-tile size step, chosen via the browser's Size control. Scales the
 *  consumer's `cardTileWidth` (S = smaller/more columns, L = larger/fewer). */
export type CardSize = 'S' | 'M' | 'L';

export interface BrowseState {
  cardQuery: string;
  seriesId: string | null;
  setId: string | null;
  /** Facet chip selection: facet key -> selected values. */
  selection: Record<string, string[]>;
  /** Sort chosen via the UI sort control; null follows the search box's `sort:` (or relevance). */
  sortSel: { field: QuerySort; dir: SortDir } | null;
  /** Card-tile size step chosen via the Size control (scales `cardTileWidth`). */
  cardSize: CardSize;
  /** The source card(s) a similarity search was run on: their ids + a short label. `injected` marks
   *  a result set pushed in from outside (e.g. a color search) — shown like similar results but with
   *  no embedding-refine controls. */
  similarTo: { ids: string[]; name: string; injected?: boolean } | null;
  similarCards: CatalogCard[];
  /**
   * The ongoing similarity session — the seed search plus every "more / less like this"
   * refinement since, in order. Feeds `find_similar_weighted` (Rocchio over the history);
   * reset whenever a fresh similarity search starts or similar mode is left.
   */
  similarSteps: SimilarStep[];
}

export const browseState: BrowseState = {
  cardQuery: '',
  seriesId: null,
  setId: null,
  selection: {},
  sortSel: null,
  cardSize: 'M',
  similarTo: null,
  similarCards: [],
  similarSteps: [],
};

/**
 * Cross-surface browse commands — lets another component on the same screen (e.g. the
 * RecentProducts feed) drive a mounted CatalogBrowser: "show cards similar to X" or
 * "open X's set". CatalogBrowser subscribes; callers use `sendBrowseCommand`.
 *
 * A command sent while nothing is subscribed (the browser is collapsed/unmounted) is
 * held as a single pending command and delivered the moment the next browser subscribes
 * — so the app can expand the browser and the command still lands.
 */
export type BrowseCommand =
  | { type: 'similar'; cardId: string }
  | { type: 'viewSet'; cardId: string }
  /** Find cards similar to ALL of these (average embedding) — e.g. a binder multi-selection. */
  | { type: 'similarMany'; cardIds: string[] }
  /** Open a set directly by its id (catalog-free — works in cold mode; ids are the catalog's
   *  string set ids). `seriesId` (the series NAME) positions the drill-down breadcrumb. */
  | { type: 'viewSetById'; setId: string; seriesId?: string }
  /** Display an EXACT, pre-ranked card-id list as a result set (e.g. a color search) — shown in the
   *  grid with the full facet / multi-select / action treatment, no embedding refine. `label` heads
   *  the results bar. Ids resolve warm (catalog) or cold (server), so it works for guests too. */
  | { type: 'showCards'; ids: string[]; label: string }
  /** Run a text query in the search box (the full grammar — e.g. `have:yes sort:value`). Clears any
   *  similar / drill-down / facet state first so the query runs clean. Used by the search-guide
   *  "Try it" buttons; held for the next mounted browser if none is up yet (pending-command). */
  | { type: 'search'; query: string };

const commandListeners = new Set<(cmd: BrowseCommand) => void>();
let pendingCommand: BrowseCommand | null = null;

/** Deliver a command to the mounted browser(s), or hold it for the next subscriber. */
export function sendBrowseCommand(cmd: BrowseCommand): void {
  if (commandListeners.size === 0) {
    pendingCommand = cmd;
    return;
  }
  commandListeners.forEach((listener) => listener(cmd));
}

/** Subscribe a browser to incoming commands; flushes any pending command immediately. */
export function subscribeBrowseCommand(listener: (cmd: BrowseCommand) => void): () => void {
  commandListeners.add(listener);
  if (pendingCommand) {
    const cmd = pendingCommand;
    pendingCommand = null;
    listener(cmd);
  }
  return () => {
    commandListeners.delete(listener);
  };
}
