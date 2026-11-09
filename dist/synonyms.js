/**
 * SIMILAR WORDS: a theme word searched as its whole synonym group (MIC-024, 2026-11-09).
 *
 * Off by default, and off changes nothing: `theme:trash` still searches trash alone. On, a bare
 * theme word that belongs to a host-supplied group ("Trash & garbage" = garbage, trash, junk,
 * litter, trash can, ...) is sent as ONE `theme_any` field carrying every member, which the server
 * matches as a union (a card matches if any member does) and ranks by the group's lift. A separate
 * field is the only way to get a union: plain theme fields are ANDed on the server.
 *
 * THE GROUPS COME FROM THE HOST. The vocabulary is the app's (michi keeps its themes in the app by
 * design); the kit only knows how to expand a word with what it was given. No groups configured,
 * no switch shown, no expansion.
 *
 * Negated words (`-trash`) are left as typed in this version: excluding a whole group would need
 * one exclusion per member, and the servers cap the number of theme terms.
 */
import { useCallback, useSyncExternalStore } from 'react';
let config = null;
const indexes = new Map();
/** Hand the kit its groups (and optionally a store for the switch). Call once at startup. */
export function configureThemeSynonyms(next) {
    config = next;
    indexes.clear();
    listeners.forEach((l) => l());
}
/** True when the host runs synonyms always on: no switch, no hint line. */
export function similarWordsAlways() {
    return config?.always === true;
}
/** True when the host gave this game any groups: the switch is only shown then. */
export function hasThemeSynonyms(game = 'pokemon') {
    return (config?.groupsByGame[game]?.length ?? 0) > 0;
}
function norm(s) {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
}
/**
 * The word forms tried for a lookup, most literal first: as typed, then a plural or -ing/-ed
 * folded off. The groups list most forms already (the data pipeline folds inflections); this only
 * catches a form the tags never used.
 */
export function wordForms(word) {
    const w = norm(word);
    const out = [w];
    const add = (f) => {
        if (f.length >= 3 && !out.includes(f))
            out.push(f);
    };
    if (w.endsWith('ies'))
        add(w.slice(0, -3) + 'y');
    if (w.endsWith('es'))
        add(w.slice(0, -2));
    if (w.endsWith('s'))
        add(w.slice(0, -1));
    if (w.endsWith('ing'))
        add(w.slice(0, -3));
    if (w.endsWith('ed'))
        add(w.slice(0, -2));
    return out;
}
function indexFor(game) {
    let idx = indexes.get(game);
    if (idx)
        return idx;
    idx = new Map();
    for (const g of config?.groupsByGame[game] ?? []) {
        // First group to claim a word keeps it; the data side keeps members unique per game anyway.
        for (const m of g.members)
            if (!idx.has(norm(m)))
                idx.set(norm(m), g);
        if (!idx.has(norm(g.label)))
            idx.set(norm(g.label), g);
    }
    indexes.set(game, idx);
    return idx;
}
/** The group a word belongs to, or null. Matches a member or the group's own label. */
export function synonymGroupFor(word, game = 'pokemon') {
    const idx = indexFor(game);
    for (const f of wordForms(word)) {
        const g = idx.get(f);
        if (g)
            return g;
    }
    return null;
}
/**
 * Rewrite a query's fields for the server. Off, or for a game with no groups: the fields as they
 * were. On: each bare, positive theme word in a group becomes one `theme_any` field. Namespaced
 * values (`scene:snow`), negations and words in no group pass through untouched.
 */
export function expandThemeFields(fields, { on, game = 'pokemon' }) {
    const plain = fields.map((f) => ({ key: f.key, value: f.value }));
    if (!on || !hasThemeSynonyms(game))
        return { fields: plain, expanded: [] };
    const rank = config?.rank ?? 'lift';
    const cap = config?.maxMembers ?? 48;
    const expanded = [];
    const out = plain.map((f, i) => {
        if (f.key !== 'theme' || f.value.startsWith('-') || f.value.includes(':'))
            return f;
        if (fields[i].exact)
            return f; // quoted: exact (MIC-024)
        const g = synonymGroupFor(f.value, game);
        if (!g)
            return f;
        const typed = norm(f.value);
        // The typed word first, so a cap never drops what the reader asked for.
        const members = [typed, ...g.members.map(norm).filter((m) => m !== typed)].slice(0, cap);
        if (members.length < 2)
            return f; // a one-word group is just the word
        expanded.push({ word: typed, group: g.label, also: members.slice(1) });
        return { key: 'theme_any', value: members, group: g.label, rank };
    });
    return { fields: out, expanded };
}
// ─── The switch ──────────────────────────────────────────────────────────────────────────────────
let on = false;
const listeners = new Set();
const subscribe = (l) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};
const snapshot = () => on;
/** The current switch. Safe outside React (the search clients read it this way). */
export function getSimilarWords() {
    return on || similarWordsAlways();
}
/** Flip the switch; persisted through the configured store unless `{ persist: false }`. */
export function setSimilarWords(next, opts = {}) {
    if (next === on)
        return;
    on = next;
    if (opts.persist !== false) {
        try {
            config?.store?.save?.(next);
        }
        catch {
            // storage is best-effort; the in-memory value stands for this session
        }
    }
    listeners.forEach((l) => l());
}
/** Subscribe to switch (and group) changes outside React. Returns an unsubscribe. */
export function subscribeSimilarWords(callback) {
    return subscribe(callback);
}
let hydrated = false;
async function hydrate() {
    if (hydrated || similarWordsAlways() || !config?.store?.load)
        return;
    hydrated = true;
    try {
        const stored = await config.store.load();
        if (typeof stored === 'boolean')
            setSimilarWords(stored, { persist: false });
    }
    catch {
        // absent or unreadable: off stands
    }
}
/** The switch as a hook, shared by every surface. Loads the stored value on first use. */
export function useSimilarWords() {
    const value = useSyncExternalStore(subscribe, snapshot, snapshot) || similarWordsAlways();
    void hydrate();
    const set = useCallback((v) => setSimilarWords(v), []);
    return [value, set];
}
/** Test hook: back to a fresh module state. */
export function __resetSimilarWordsForTests() {
    config = null;
    indexes.clear();
    on = false;
    hydrated = false;
}
