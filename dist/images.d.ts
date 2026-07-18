/**
 * Persistent key→value the app injects (e.g. AsyncStorage / localStorage) so the
 * manifest survives across launches for fast first paint. Optional: without it,
 * the manifest is fetched fresh each session (still correct, just not cached).
 */
export interface ManifestCache {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
}
/** Install the persistent cache adapter (called by configureBrowse). */
export declare function setManifestCache(cache: ManifestCache | null): void;
/**
 * Fire when the manifest lands or is refreshed, so components that resolve image
 * URLs via `cardThumbUrl` can re-render. Returns an unsubscribe function.
 */
export declare function subscribeImageManifest(callback: () => void): () => void;
/** id + field → absolute content-hashed URL, or undefined if unmapped/not loaded.
 * Handles both manifest schemas: in schema 2 the card entry leads with its
 * language and the per-field base is nested under that language. */
export declare function manifestUrl(id: string, field: string): string | undefined;
/** True once a manifest (cached or fresh) is in memory. */
export declare function imageManifestReady(): boolean;
/**
 * Load the manifest once: instant from the injected cache, then refresh from the
 * server in the background. Idempotent (safe to call from every mount). A missing
 * images.json (static mode / offline) is a no-op — cardThumbUrl falls back to the
 * flat convention path, which is correct for local static assets.
 */
export declare function hydrateImageManifest(): Promise<void>;
/**
 * React helper: hydrate the manifest and re-render when it lands/updates, so a
 * screen's `cardThumbUrl` covers repaint with their content-hashed URLs. Returns
 * whether a manifest is currently loaded.
 */
export declare function useImageManifest(): boolean;
