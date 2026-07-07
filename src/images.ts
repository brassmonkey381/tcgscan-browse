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
import { useEffect, useState } from 'react';

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

interface ImageManifest {
  fields: string[]; // ["image", "image_small", "image_medium"]
  base: Record<string, string>; // field → absolute bucket base URL
  cards: Record<string, (string | null)[]>; // id → per-field relative hashed key (null = absent)
}

// Bump the version suffix if the manifest shape changes (invalidates stale caches).
const CACHE_KEY = 'tcgscan-browse:images-manifest:v1';

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

/** id + field → absolute content-hashed URL, or undefined if unmapped/not loaded. */
export function manifestUrl(id: string, field: string): string | undefined {
  if (!manifest || !id) return undefined;
  const i = manifest.fields.indexOf(field);
  if (i < 0) return undefined;
  const key = manifest.cards[id]?.[i];
  const base = manifest.base[field];
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
  const [, bump] = useState(0);
  useEffect(() => {
    const unsub = subscribeImageManifest(() => bump((v) => v + 1));
    hydrateImageManifest();
    return unsub;
  }, []);
  return imageManifestReady();
}
