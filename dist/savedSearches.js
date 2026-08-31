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
const STORAGE_KEY = 'tcgscan-browse.savedSearches';
const MAX_SAVED = 12;
/** In-memory copy — the source of truth; localStorage (web) just seeds/mirrors it. */
let saved = load();
const listeners = new Set();
function storage() {
    try {
        // RN native has no localStorage; web (and web workers won't run this) does.
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }
    catch {
        return null; // e.g. privacy mode denying access
    }
}
function load() {
    try {
        const raw = storage()?.getItem(STORAGE_KEY);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.label === 'string') : [];
    }
    catch {
        return [];
    }
}
function persist() {
    try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(saved));
    }
    catch {
        // quota/privacy failures degrade to session-only — same as native
    }
    try {
        getSavedSearchStore()?.save?.(saved);
    }
    catch {
        // the app's storage is best-effort too; the in-memory list still stands for this session
    }
    listeners.forEach((l) => l());
}
/** Keep only well-formed entries — a corrupt or half-written store must not crash the browser. */
function sanitize(list) {
    return list.filter((s) => !!s && typeof s.label === 'string' && typeof s.query === 'string');
}
let hydrated = false;
/**
 * Load the persisted list through the app-supplied store, once per session. Adopting does NOT
 * write back. Anything already starred THIS session wins over the stored copy, so a star tapped
 * before a slow native read lands is never swallowed by it.
 */
export async function hydrateSavedSearches() {
    if (hydrated)
        return;
    hydrated = true;
    try {
        const stored = await getSavedSearchStore()?.load?.();
        if (!stored?.length)
            return;
        const fromStore = sanitize(stored).filter((s) => !saved.some((x) => sameSearch(x, s)));
        if (!fromStore.length)
            return;
        saved = [...saved, ...fromStore].slice(0, MAX_SAVED);
        listeners.forEach((l) => l());
    }
    catch {
        // absent / corrupt / offline — whatever is in memory stands
    }
}
export function listSavedSearches() {
    return saved;
}
/** Two saves are "the same search" when query + facets + sort all match. */
export function sameSearch(a, b) {
    return (a.query.trim() === b.query.trim() &&
        JSON.stringify(a.selection) === JSON.stringify(b.selection) &&
        JSON.stringify(a.sortSel) === JSON.stringify(b.sortSel));
}
export function isSearchSaved(s) {
    return saved.some((x) => sameSearch(x, s));
}
/** Toggle: saves the search, or removes it if an identical one is already saved. */
export function toggleSavedSearch(s) {
    const existing = saved.findIndex((x) => sameSearch(x, s));
    if (existing >= 0)
        saved = saved.filter((_, i) => i !== existing);
    else
        saved = [s, ...saved].slice(0, MAX_SAVED);
    persist();
}
export function removeSavedSearch(s) {
    saved = saved.filter((x) => !sameSearch(x, s));
    persist();
}
/** Subscribe to list changes (any surface saving updates every mounted browser). */
export function subscribeSavedSearches(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
