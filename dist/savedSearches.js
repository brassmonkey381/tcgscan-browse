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
    listeners.forEach((l) => l());
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
