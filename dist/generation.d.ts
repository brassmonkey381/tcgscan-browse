/** The current data generation. Starts at 0; bumped by every reset. */
export declare function browseGeneration(): number;
/** True when `started` is still the live generation: the load that captured it may publish. */
export declare function isCurrent(started: number): boolean;
/** Internal: advance the generation and tell subscribers. Called by resetBrowseData only. */
export declare function _bumpGeneration(): void;
/**
 * React: the current generation, re-rendering on every reset. Use it as a `key` on whatever holds
 * a loaded catalog in state, so a game switch remounts it:
 *
 *   const gen = useBrowseGeneration();
 *   <CatalogBrowser key={gen} ... />
 */
export declare function useBrowseGeneration(): number;
