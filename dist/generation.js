/**
 * THE DATA GENERATION: which game's data the kit is currently pointed at.
 *
 * Every per-game cache in the kit (catalog, prices, sealed, taxonomy, the image manifest, the
 * server-search caches) is a load-once module singleton. That was right while a host served one
 * game per page load, and a reload reset all of them for free. A host that switches games in
 * place has to reset them itself, and any one forgotten serves the other game's cards.
 *
 * `resetBrowseData` (config.ts) clears each of them and bumps this counter. Two things read it:
 *  - a load that STARTED under an older generation must not publish when it lands, or a slow
 *    Pokemon catalog would overwrite the One Piece one the person just switched to. Each loader
 *    captures the generation at start and checks it on arrival (`isCurrent`).
 *  - a host keys a remount on `useBrowseGeneration()`, so components holding a loaded catalog in
 *    React state (CatalogBrowser, useSealed, useTaxonomy, usePriceSummary) start over.
 *
 * No imports, so every module can depend on it without a cycle.
 */
import { useSyncExternalStore } from 'react';
let generation = 0;
const listeners = new Set();
/** The current data generation. Starts at 0; bumped by every reset. */
export function browseGeneration() {
    return generation;
}
/** True when `started` is still the live generation: the load that captured it may publish. */
export function isCurrent(started) {
    return started === generation;
}
/** Internal: advance the generation and tell subscribers. Called by resetBrowseData only. */
export function _bumpGeneration() {
    generation += 1;
    listeners.forEach((cb) => cb());
}
function subscribe(cb) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}
/**
 * React: the current generation, re-rendering on every reset. Use it as a `key` on whatever holds
 * a loaded catalog in state, so a game switch remounts it:
 *
 *   const gen = useBrowseGeneration();
 *   <CatalogBrowser key={gen} ... />
 */
export function useBrowseGeneration() {
    return useSyncExternalStore(subscribe, browseGeneration, browseGeneration);
}
