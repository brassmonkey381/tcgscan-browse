/**
 * Content-hashed image resolution — the lite id→image manifest published by the
 * tcgscan-data pipeline as `browse/images.json`.
 *
 * The hosted buckets key images by CONTENT HASH (`<id>.<hash>.jpg|webp`) so a
 * URL is immutable and caches for a year — which means a card's image path is
 * NO LONGER constructible from its id alone (the old `card-thumbs/245/<id>.webp`
 * convention). This manifest is the resolver: id → [image, image_small,
 * image_medium] as a shared per-field base + relative hashed key.
 *
 * It's the small artifact `cardThumbUrl` needs to show a card WITHOUT the ~25MB
 * catalog. To keep first paint instant, the app injects a persistent cache
 * adapter (AsyncStorage-backed) via `configureBrowse({ cache })`: on launch the
 * manifest hydrates from that cache synchronously-fast, then refreshes from the
 * network in the background. Because the URLs are immutable, a cached copy is
 * always safe to paint first; the refresh only adds/updates changed ids.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { getBrowseUrl } from './config';

/**
 * Persistent key→value the app injects (e.g. AsyncStorage / localStorage) so the
 * manifest survives across launches for fast first paint. Optional: without it,
 * the manifest is fetched fresh each session (still correct, just not cached).
 */
export interface ManifestCache {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Two manifest schemas are supported (back-compat):
 *   schema 1 (default): single-language. base = {field → url};
 *     cards[id] = [imageKey, smallKey, medKey].
 *   schema 2 (EN+JP): per-language buckets. base = {lang → {field → url}};
 *     cards[id] = [lang, imageKey, smallKey, medKey] — each card names its own
 *     language, so callers still resolve by id alone (cardThumbUrl unchanged).
 */
interface ImageManifest {
  schema?: number; // 1 (default, legacy) | 2 (per-language)
  fields: string[]; // ["image", "image_small", "image_medium"]
  base: Record<string, string> | Record<string, Record<string, string>>;
  cards: Record<string, (string | null)[]>;
}

// Bump the version suffix when the manifest shape OR its coverage changes, to invalidate stale
// persisted copies. v3: EN+JP coverage — clients that cached an EN-only manifest (before JP card
// entries shipped) must drop it, else JP ids resolve to nothing (blank tiles) until a lucky
// refresh. A key bump forces a clean re-pull of the full EN+JP manifest on next launch.
const CACHE_KEY = 'tcgscan-browse:images-manifest:v3';

let cacheAdapter: ManifestCache | null = null;
let manifest: ImageManifest | null = null;
let hydrating: Promise<void> | null = null;
const subscribers = new Set<() => void>();

/** Install the persistent cache adapter (called by configureBrowse). */
export function setManifestCache(cache: ManifestCache | null): void {
  cacheAdapter = cache;
}

/**
 * Fire when the manifest lands or is refreshed, so components that resolve image
 * URLs via `cardThumbUrl` can re-render. Returns an unsubscribe function.
 */
export function subscribeImageManifest(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function publish(next: ImageManifest): void {
  manifest = next;
  subscribers.forEach((cb) => cb());
}

/** id + field → absolute content-hashed URL, or undefined if unmapped/not loaded.
 * Handles both manifest schemas: in schema 2 the card entry leads with its
 * language and the per-field base is nested under that language. */
export function manifestUrl(id: string, field: string): string | undefined {
  if (!manifest || !id) return undefined;
  const i = manifest.fields.indexOf(field);
  if (i < 0) return undefined;
  const entry = manifest.cards[id];
  if (!entry) return undefined;
  if (manifest.schema === 2) {
    const lang = entry[0] as string; // 'en' | 'ja'
    const key = entry[i + 1]; // keys shift right by one for the leading lang tag
    const base = (manifest.base as Record<string, Record<string, string>>)[lang]?.[field];
    return key && base ? `${base}/${key}` : undefined;
  }
  const key = entry[i];
  const base = (manifest.base as Record<string, string>)[field];
  return key && base ? `${base}/${key}` : undefined;
}

/** True once a manifest (cached or fresh) is in memory. */
export function imageManifestReady(): boolean {
  return manifest !== null;
}

/**
 * Load the manifest once: instant from the injected cache, then refresh from the
 * server in the background. Idempotent (safe to call from every mount). A missing
 * images.json (static mode / offline) is a no-op — cardThumbUrl falls back to the
 * flat convention path, which is correct for local static assets.
 */
export function hydrateImageManifest(): Promise<void> {
  if (!hydrating) {
    hydrating = (async () => {
      // 1) instant paint from the persisted cache (if the app injected one)
      if (cacheAdapter) {
        try {
          const raw = await cacheAdapter.getItem(CACHE_KEY);
          if (raw && !manifest) publish(JSON.parse(raw) as ImageManifest);
        } catch {
          /* corrupt/absent cache — fall through to the network */
        }
      }
      // 2) background refresh (best-effort; content-hashed URLs make this safe)
      try {
        const res = await fetch(`${getBrowseUrl()}/images.json`);
        if (res.ok) {
          const fresh = (await res.json()) as ImageManifest;
          publish(fresh);
          if (cacheAdapter) {
            try {
              await cacheAdapter.setItem(CACHE_KEY, JSON.stringify(fresh));
            } catch {
              /* quota / write failure — the in-memory copy is still good */
            }
          }
        }
      } catch {
        /* offline or static mode — convention fallback covers it */
      }
    })();
  }
  return hydrating;
}

/**
 * React helper: hydrate the manifest and re-render when it lands/updates, so a
 * screen's `cardThumbUrl` covers repaint with their content-hashed URLs. Returns
 * whether a manifest is currently loaded.
 */
export function useImageManifest(): boolean {
  useEffect(() => {
    hydrateImageManifest();
  }, []);
  // useSyncExternalStore (not subscribe-in-effect + manual bump): the manifest can publish in
  // the window BETWEEN a component's first render and its effect subscribing — with a manual
  // bump that publish is missed and the component stays "not ready" forever (covers stuck on
  // fallback paths until reload). uSES re-reads the snapshot at subscription time, closing the
  // race. Server snapshot: never ready during SSR.
  return useSyncExternalStore(subscribeImageManifest, imageManifestReady, () => false);
}
