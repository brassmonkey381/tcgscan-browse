/**
 * Persistent key→value the app injects (e.g. AsyncStorage / localStorage) so the
 * manifest survives across launches for fast first paint. Optional: without it,
 * the manifest is fetched fresh each session (still correct, just not cached).
 */
export interface ManifestCache {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
}
/** Monotonic counter over manifest publishes (primary and secondary). See `useImageManifest`. */
export declare function imageManifestRevision(): number;
/** Install the persistent cache adapter (called by configureBrowse). */
export declare function setManifestCache(cache: ManifestCache | null): void;
/**
 * Fire when the manifest lands or is refreshed, so components that resolve image
 * URLs via `cardThumbUrl` can re-render. Returns an unsubscribe function.
 */
export declare function subscribeImageManifest(callback: () => void): () => void;
/** id + field → absolute content-hashed URL, or undefined if unmapped/not loaded. The primary
 *  manifest answers first; registered secondaries (see registerImageManifest) fill in ids it has
 *  never heard of — another game's cards, in a host that shows more than one. */
export declare function manifestUrl(id: string, field: string): string | undefined;
/** True once a manifest (cached or fresh) is in memory. */
export declare function imageManifestReady(): boolean;
export interface SecondaryManifest {
    /** Stable id for this source, e.g. 'onepiece'. Registering the same key twice is a no-op. */
    key: string;
    /** Bucket root holding its `images.json` (the other game's browseUrl). */
    browseUrl: string;
    /** Persistent-cache key for this manifest. Omit to skip caching it. */
    cacheKey?: string;
}
/**
 * Declare another source `cardThumbUrl` may fall through to. RECORD-ONLY: nothing is fetched here.
 *
 * That is the whole point. A host registers its second game once, at startup, but the manifest is
 * only worth bytes to someone who actually has one of those cards on screen — so the fetch waits
 * for the first id the PRIMARY manifest cannot resolve (see manifestUrl). A single-game user's ids
 * all hit the primary, so they never pay for a registration that is merely declared.
 *
 * Idempotent, and safe at import time. Call `loadImageManifest(key)` to force it early.
 */
export declare function registerImageManifest(source: SecondaryManifest): void;
/** Fetch a registered secondary now (idempotent). Called on demand by manifestUrl. */
export declare function loadImageManifest(key: string): Promise<void>;
/** True once any registered secondary has landed (for hosts that want to gate on it). */
export declare function secondaryManifestReady(key?: string): boolean;
/**
 * True once the first hydrate attempt has finished, whether or not it produced a manifest. While
 * this is false a hosted manifest is still in flight, so `cardThumbUrl` should paint a placeholder
 * rather than a doomed flat-convention URL (which 404s on hosted buckets that key by content hash).
 */
export declare function imageManifestSettled(): boolean;
/**
 * Load the manifest once: instant from the injected cache, then refresh from the
 * server in the background. Idempotent (safe to call from every mount). A missing
 * images.json (static mode / offline) is a no-op — cardThumbUrl falls back to the
 * flat convention path, which is correct for local static assets.
 */
export declare function hydrateImageManifest(): Promise<void>;
/**
 * Internal: forget the PRIMARY manifest (resetBrowseData). The next hydrate reads the new
 * browseUrl's images.json. Registered secondaries, loaded or not, stay: they are the host's other
 * games, keyed by their own URLs, and the one the host just switched TO may be among them.
 */
export declare function _resetImageManifest(): void;
/**
 * React helper: hydrate the manifest and re-render when it lands/updates, so a
 * screen's `cardThumbUrl` covers repaint with their content-hashed URLs. Returns
 * whether a manifest is currently loaded.
 */
export declare function useImageManifest(): boolean;
