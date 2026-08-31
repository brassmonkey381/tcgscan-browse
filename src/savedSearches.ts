/**
 * Saved searches — star a search (query text + facet selection + sort) to pin it as a
 * one-tap chip under the search box. Persistence, best-effort, in precedence order:
 *   · an app-supplied `savedSearchStore` (configureBrowse) — the only option that survives a
 *     NATIVE relaunch, since RN has no localStorage
 *   · web      — localStorage (per browser, survives reloads)
 *   · native   — module memory (session-sticky, like browseState; gone on relaunch)
 * The kit owns the list so every consumer surface (browse page, binder card picker) shares it
 * with zero app wiring; the store is only about where the bytes land.
 */
import { getSavedSearchStore } from './config';
import type { QuerySort, SortDir } from './query';

export interface SavedSearch {
  /** Chip label — the raw query text (or where it was saved, when the query is empty). */
  label: string;
  query: string;
  selection: Record<string, string[]>;
  sortSel: { field: QuerySort; dir: SortDir } | null;
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

const STORAGE_KEY = 'tcgscan-browse.savedSearches';
const MAX_SAVED = 12;

/** In-memory copy — the source of truth; localStorage (web) just seeds/mirrors it. */
let saved: SavedSearch[] = load();
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    // RN native has no localStorage; web (and web workers won't run this) does.
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // e.g. privacy mode denying access
  }
}

function load(): SavedSearch[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.label === 'string') : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    // localStorage is safe to write unconditionally: it seeds `saved` synchronously at import, so
    // this list has always already absorbed it.
    storage()?.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // quota/privacy failures degrade to session-only — same as native
  }
  // THE APP STORE IS NOT. Its read is async, so until it has come back this list may not have
  // absorbed what the device holds, and `save` overwrites the WHOLE list. Writing early is how a
  // single star tapped at launch (or one failed read) replaced every search a user had saved.
  // Defer instead: hydration performs the write once it knows what was there.
  if (hydratedOk) {
    try {
      getSavedSearchStore()?.save?.(saved);
    } catch {
      // the app's storage is best-effort too; the in-memory list still stands for this session
    }
  } else {
    pendingStoreWrite = true;
  }
  listeners.forEach((l) => l());
}

/** Keep only well-formed entries — a corrupt or half-written store must not crash the browser. */
function sanitize(list: unknown[]): SavedSearch[] {
  return list.filter(
    (s): s is SavedSearch =>
      !!s && typeof (s as SavedSearch).label === 'string' && typeof (s as SavedSearch).query === 'string',
  );
}

/** True once a store read has SUCCEEDED, which is the only state in which writing it is safe. */
let hydratedOk = false;
/** A write persist() had to defer because the stored list was still unknown. */
let pendingStoreWrite = false;
/** The in-flight read, so several mounted browsers share one and none of them re-issues it. */
let hydrating: Promise<void> | null = null;

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
export async function hydrateSavedSearches(): Promise<void> {
  if (hydratedOk) return;
  if (hydrating) return hydrating;
  const store = getSavedSearchStore();
  if (!store?.load) {
    // No app store: localStorage (or memory) is the whole truth, and it is already loaded.
    hydratedOk = true;
    return;
  }
  hydrating = (async () => {
    try {
      const stored = await store.load!();
      const fromStore = sanitize(stored ?? []).filter((s) => !saved.some((x) => sameSearch(x, s)));
      const changed = fromStore.length > 0;
      if (changed) saved = [...saved, ...fromStore].slice(0, MAX_SAVED);
      hydratedOk = true;
      // Write back when the merge moved anything, or when a star landed mid-read: either way the
      // device is now holding less than we are.
      if (changed || pendingStoreWrite) {
        pendingStoreWrite = false;
        try {
          store.save?.(saved);
        } catch {
          // best-effort, same as every other write here
        }
      }
      if (changed) listeners.forEach((l) => l());
    } catch {
      // Unknown, not empty: leave the latch clear so a later mount retries, and keep suppressing
      // store writes so nothing overwrites a list we have never managed to read.
    } finally {
      hydrating = null;
    }
  })();
  return hydrating;
}

// CROSS-TAB. Each tab holds its own copy of this list and writes it whole, so without this a star
// in one tab stamped back every search deleted in another, and a deletion "came back" after a
// reload. The storage event fires only in the OTHER tabs, so re-seeding here keeps every open tab
// current and means the next write is built on a fresh snapshot. Feature-tested rather than
// window-tested, so it no-ops on native.
(globalThis as { addEventListener?: (t: string, cb: (e: { key?: string | null }) => void) => void })
  .addEventListener?.('storage', (e) => {
    if (e?.key && e.key !== STORAGE_KEY) return;
    saved = load();
    listeners.forEach((l) => l());
  });

export function listSavedSearches(): SavedSearch[] {
  return saved;
}

/**
 * A facet selection reduced to its MEANING, so identity does not depend on how it was typed in.
 *
 * `selection` is built by tapping chips, and the object literal records that history: the key
 * order is the order the FACETS were first touched, and each array is in the order its VALUES
 * were tapped. Two identical-looking filter sets therefore stringify differently, and an
 * untoggled value leaves an invisible `{facet: []}` behind that is not the same as its absence.
 * Comparing raw JSON made all three of those a different search: the star went hollow on a
 * search the user had already starred, tapping it added a second identical chip instead of
 * un-starring, and the duplicates ate the 12-slot budget.
 *
 * Sorted keys, sorted values, empty facets dropped. This only RELAXES the comparison, so entries
 * already on disk keep matching.
 */
function canonicalSelection(selection: Record<string, string[]> | undefined): string {
  const s = selection ?? {};
  return JSON.stringify(
    Object.keys(s)
      .sort()
      .filter((k) => (s[k]?.length ?? 0) > 0)
      .map((k) => [k, [...s[k]].sort()]),
  );
}

/** Two saves are "the same search" when query + facets + sort all match. */
export function sameSearch(a: SavedSearch, b: SavedSearch): boolean {
  return (
    a.query.trim() === b.query.trim() &&
    canonicalSelection(a.selection) === canonicalSelection(b.selection) &&
    JSON.stringify(a.sortSel) === JSON.stringify(b.sortSel) &&
    (a.setId ?? null) === (b.setId ?? null) &&
    (a.seriesId ?? null) === (b.seriesId ?? null)
  );
}

export function isSearchSaved(s: SavedSearch): boolean {
  return saved.some((x) => sameSearch(x, s));
}

/**
 * Toggle: saves the search, or removes it if an identical one is already saved.
 *
 * Un-starring removes EVERY match, not the first: users who hit the old identity bug have
 * duplicate entries on disk, and removing one at a time left an identical chip behind that looked
 * like the star had failed.
 */
export function toggleSavedSearch(s: SavedSearch): void {
  const without = saved.filter((x) => !sameSearch(x, s));
  saved = without.length < saved.length ? without : [s, ...saved].slice(0, MAX_SAVED);
  persist();
}

export function removeSavedSearch(s: SavedSearch): void {
  saved = saved.filter((x) => !sameSearch(x, s));
  persist();
}

/** Subscribe to list changes (any surface saving updates every mounted browser). */
export function subscribeSavedSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
