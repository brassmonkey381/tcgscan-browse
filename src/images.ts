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
import { browseGeneration, isCurrent } from './generation';

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
// True once the first hydrate attempt FINISHES (with or without a manifest). Lets cardThumbUrl tell
// "manifest still loading" (paint a placeholder, no doomed request) apart from "genuinely static /
// offline, no manifest is coming" (use the flat convention path).
let settled = false;
const subscribers = new Set<() => void>();
/**
 * Bumped on every publish — the primary landing, a secondary landing, the settle. It exists so a
 * subscriber's snapshot actually CHANGES: `imageManifestReady()` is a boolean over the primary
 * alone, so a second manifest arriving left it identical and React bailed out of the re-render,
 * leaving that game's art blank until something unrelated repainted.
 */
let revision = 0;

function notify(): void {
  revision += 1;
  subscribers.forEach((cb) => cb());
}

/** Monotonic counter over manifest publishes (primary and secondary). See `useImageManifest`. */
export function imageManifestRevision(): number {
  return revision;
}

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
  notify();
}

/** One manifest's answer for id + field, or undefined. Both schemas: in schema 2 the card entry
 *  leads with its language and the per-field base is nested under that language. */
function urlIn(m: ImageManifest, id: string, field: string): string | undefined {
  const i = m.fields.indexOf(field);
  if (i < 0) return undefined;
  const entry = m.cards[id];
  if (!entry) return undefined;
  if (m.schema === 2) {
    const lang = entry[0] as string; // 'en' | 'ja'
    const key = entry[i + 1]; // keys shift right by one for the leading lang tag
    const base = (m.base as Record<string, Record<string, string>>)[lang]?.[field];
    return key && base ? `${base}/${key}` : undefined;
  }
  const key = entry[i];
  const base = (m.base as Record<string, string>)[field];
  return key && base ? `${base}/${key}` : undefined;
}

/** id + field → absolute content-hashed URL, or undefined if unmapped/not loaded. The primary
 *  manifest answers first; registered secondaries (see registerImageManifest) fill in ids it has
 *  never heard of — another game's cards, in a host that shows more than one. */
export function manifestUrl(id: string, field: string): string | undefined {
  if (!id) return undefined;
  const primary = manifest ? urlIn(manifest, id, field) : undefined;
  if (primary) return primary;
  // Sharded mode: an id with no answer yet asks for its own shard (or the full list once its
  // shard is known not to hold it). A no-op when sharding is off.
  if (shardMode && !(manifest && manifest.cards[id])) requestShardFor(id);
  for (const m of secondaries.values()) {
    const hit = urlIn(m, id, field);
    if (hit) return hit;
  }
  // A miss on a LOADED primary is the first evidence that a registered second source might be
  // needed, so it is what pays for fetching one. Gated on the primary being loaded: before that,
  // every id "misses" and a single-game host would pull manifests it will never read.
  if (manifest && primaryCovers(id) && registered.size > started.size) {
    for (const key of registered.keys()) void loadImageManifest(key);
  }
  return undefined;
}

/** True once a manifest (cached or fresh) is in memory. */
export function imageManifestReady(): boolean {
  return manifest !== null;
}

// ---- secondary manifests (a host showing more than one game) ------------------------------
//
// The kit resolves art INSIDE itself — CatalogBrowser's tiles and CardActionModal call
// `cardThumbUrl` directly — so a host cannot wrap its way to a second game's pictures from outside.
// A registered secondary is consulted only AFTER the primary misses, so nothing about a
// single-game host changes: with none registered, every path below is the code that shipped before.
//
// Each secondary caches under its OWN key, never the primary's: they are different byte streams and
// sharing one key would have each overwrite the other on every launch.

const secondaries = new Map<string, ImageManifest>();
const registered = new Map<string, SecondaryManifest>();
const started = new Set<string>();

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
export function registerImageManifest(source: SecondaryManifest): void {
  if (!registered.has(source.key)) registered.set(source.key, source);
}

/** Fetch a registered secondary now (idempotent). Called on demand by manifestUrl. */
export function loadImageManifest(key: string): Promise<void> {
  const source = registered.get(key);
  if (!source || started.has(key)) return Promise.resolve();
  started.add(key);
  const publish = (m: ImageManifest): void => {
    secondaries.set(source.key, m);
    notify();
  };
  return (async () => {
    if (cacheAdapter && source.cacheKey) {
      try {
        const raw = await cacheAdapter.getItem(source.cacheKey);
        if (raw && !secondaries.has(source.key)) publish(JSON.parse(raw) as ImageManifest);
      } catch {
        /* corrupt/absent cache — the network copy below is the real answer */
      }
    }
    try {
      const res = await fetch(`${source.browseUrl}/images.json`);
      if (!res.ok) return;
      const fresh = (await res.json()) as ImageManifest;
      publish(fresh);
      if (cacheAdapter && source.cacheKey) {
        try {
          await cacheAdapter.setItem(source.cacheKey, JSON.stringify(fresh));
        } catch {
          /* quota / write failure — the in-memory copy is still good */
        }
      }
    } catch {
      started.delete(key); // let a later miss retry rather than pinning the failure
    }
  })();
}

/** True once any registered secondary has landed (for hosts that want to gate on it). */
export function secondaryManifestReady(key?: string): boolean {
  return key ? secondaries.has(key) : secondaries.size > 0;
}


// ---- sharded primary manifest (opt-in, v0.9.65) --------------------------------------------
//
// THE WHOLE LIST BEFORE ONE PICTURE (michi MIC-018, 2026-11-07): images.json is 1.77 MB and a
// card's picture cannot be named until it lands, so a phone on slow 4G showed its first card at
// 36.8 s for a page of nine. With `configureBrowse({ imageShards: true })` the kit reads
// `browse/images-shards/v1/index.json` and then only the shards for the ids actually asked for
// (FNV-1a 32 of the id's UTF-8 bytes, mod the index's count, two-digit file name). Same schema as
// images.json; shards merge into the primary manifest, so every reader above is unchanged.
//
// Falls back to the full images.json (the code that shipped before) when the index is missing,
// and when an id is absent from its own LOADED shard: the pipeline writes shards in the same step
// as images.json but not atomically with it, so a shard may be one publish behind.
// A merged partial manifest is never written to the persistent cache (that key holds whole lists).

let shardMode = false;
type ShardIndex = { shards: number };
let shardIndex: ShardIndex | 'absent' | null = null;
let shardIndexStarted = false;
const shardsLoaded = new Set<number>();
const shardsStarted = new Set<number>();
const shardWaiting = new Set<string>();
let fullStarted = false;

/** Turn sharded primary loading on or off (configureBrowse). Off is the default and the old path. */
export function setImageShards(on: boolean): void {
  shardMode = on;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `id`, as the tcgscan-data publisher computes it. */
export function imageShardHash(id: string): number {
  const bytes = unescape(encodeURIComponent(id));
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function shardOf(id: string, index: ShardIndex): number {
  return imageShardHash(id) % index.shards;
}

/** True when a primary miss for `id` is a real miss, not a shard that has not arrived yet. */
function primaryCovers(id: string): boolean {
  if (!shardMode || fullStarted || shardIndex === 'absent') return true;
  if (shardIndex === null) return false;
  return shardsLoaded.has(shardOf(id, shardIndex));
}

function mergeShard(part: ImageManifest): void {
  if (!manifest) {
    publish({ schema: part.schema, fields: part.fields, base: part.base, cards: { ...part.cards } });
  } else {
    publish({ ...manifest, cards: { ...manifest.cards, ...part.cards } });
  }
  if (!settled) settled = true;
}

function loadFullPrimary(): void {
  if (fullStarted) return;
  fullStarted = true;
  const gen = browseGeneration();
  void (async () => {
    try {
      const res = await fetch(`${getBrowseUrl()}/images.json`);
      if (!res.ok || !isCurrent(gen)) return;
      const fresh = (await res.json()) as ImageManifest;
      if (!isCurrent(gen)) return;
      publish(fresh);
      if (cacheAdapter) {
        try {
          await cacheAdapter.setItem(CACHE_KEY, JSON.stringify(fresh));
        } catch {
          /* quota / write failure: the in-memory copy is still good */
        }
      }
    } catch {
      fullStarted = false; // a later miss may retry
    } finally {
      if (isCurrent(gen) && !settled) {
        settled = true;
        notify();
      }
    }
  })();
}

function loadShardIndex(): void {
  if (shardIndexStarted) return;
  shardIndexStarted = true;
  const gen = browseGeneration();
  void (async () => {
    let next: ShardIndex | 'absent' = 'absent';
    try {
      const res = await fetch(`${getBrowseUrl()}/images-shards/v1/index.json`);
      if (res.ok) {
        const body = (await res.json()) as { shards?: number };
        if (typeof body.shards === 'number' && body.shards > 0) next = { shards: body.shards };
      }
    } catch {
      /* offline or not published: the full list below */
    }
    if (!isCurrent(gen)) return;
    shardIndex = next;
    if (next === 'absent') {
      loadFullPrimary();
      return;
    }
    const waiting = [...shardWaiting];
    shardWaiting.clear();
    waiting.forEach(requestShardFor);
  })();
}

function requestShardFor(id: string): void {
  if (!shardMode || fullStarted) return;
  if (shardIndex === null) {
    shardWaiting.add(id);
    loadShardIndex();
    return;
  }
  if (shardIndex === 'absent') return;
  const n = shardOf(id, shardIndex);
  if (shardsLoaded.has(n)) {
    // Its own shard is in and does not hold it: one publish behind, or never mirrored. The full
    // list answers both.
    loadFullPrimary();
    return;
  }
  if (shardsStarted.has(n)) return;
  shardsStarted.add(n);
  const gen = browseGeneration();
  void (async () => {
    try {
      const res = await fetch(`${getBrowseUrl()}/images-shards/v1/${String(n).padStart(2, '0')}.json`);
      if (!isCurrent(gen)) return;
      if (!res.ok) {
        loadFullPrimary();
        return;
      }
      const part = (await res.json()) as ImageManifest;
      if (!isCurrent(gen)) return;
      shardsLoaded.add(n);
      mergeShard(part);
    } catch {
      shardsStarted.delete(n);
      if (isCurrent(gen)) loadFullPrimary();
    }
  })();
}

/**
 * True once the first hydrate attempt has finished, whether or not it produced a manifest. While
 * this is false a hosted manifest is still in flight, so `cardThumbUrl` should paint a placeholder
 * rather than a doomed flat-convention URL (which 404s on hosted buckets that key by content hash).
 */
export function imageManifestSettled(): boolean {
  return settled;
}

/**
 * Load the manifest once: instant from the injected cache, then refresh from the
 * server in the background. Idempotent (safe to call from every mount). A missing
 * images.json (static mode / offline) is a no-op — cardThumbUrl falls back to the
 * flat convention path, which is correct for local static assets.
 */
export function hydrateImageManifest(): Promise<void> {
  if (!hydrating) {
    const gen = browseGeneration();
    // Everything this hydrate publishes goes through here, so a hydrate that started before a
    // game switch cannot land the old game's pictures over the new one's.
    const publishIfCurrent = (m: ImageManifest) => {
      if (isCurrent(gen)) publish(m);
    };
    hydrating = (async () => {
      try {
        // 1) instant paint from the persisted cache (if the app injected one)
        if (cacheAdapter) {
          try {
            const raw = await cacheAdapter.getItem(CACHE_KEY);
            if (raw && !manifest) publishIfCurrent(JSON.parse(raw) as ImageManifest);
          } catch {
            /* corrupt/absent cache — fall through to the network */
          }
        }
        // 2) background refresh (best-effort; content-hashed URLs make this safe). In sharded mode
        // there is no whole-list refresh: shards arrive as ids are asked for (requestShardFor).
        if (shardMode) return;
        try {
          const res = await fetch(`${getBrowseUrl()}/images.json`);
          if (res.ok) {
            const fresh = (await res.json()) as ImageManifest;
            publishIfCurrent(fresh);
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
      } finally {
        // Mark the attempt done and wake consumers: in static/offline mode no manifest ever
        // publishes, so this settle is what lets cardThumbUrl fall through to the flat path.
        // A hydrate from before a game switch settles nothing: the new one is in charge.
        // Sharded mode settles on its first shard (or the full-list fallback) instead: settling
        // with no manifest would send cardThumbUrl to the flat path, which 404s on hosted buckets.
        if (isCurrent(gen) && (!shardMode || manifest)) {
          settled = true;
          notify();
        }
      }
    })();
  }
  return hydrating;
}

/**
 * Internal: forget the PRIMARY manifest (resetBrowseData). The next hydrate reads the new
 * browseUrl's images.json. Registered secondaries, loaded or not, stay: they are the host's other
 * games, keyed by their own URLs, and the one the host just switched TO may be among them.
 */
export function _resetImageManifest(): void {
  manifest = null;
  hydrating = null;
  settled = false;
  shardIndex = null;
  shardIndexStarted = false;
  shardsLoaded.clear();
  shardsStarted.clear();
  shardWaiting.clear();
  fullStarted = false;
  notify();
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
  /**
   * THE REVISION IS THE SNAPSHOT, and the boolean is derived from it.
   *
   * It must be a value the component actually uses: under the React Compiler, a bare
   * `imageManifestReady()` call (a read of module state with no reactive input) is memoised as a
   * constant, so the component re-renders when the store fires and still returns the STALE
   * `false` — cards stay blank on a cold load until an unrelated re-render. `rev` is that reactive
   * input, and unlike the old boolean snapshot it also CHANGES when a secondary manifest lands
   * (another game's art), which a primary-only boolean could never express. uSES re-reads the
   * snapshot at subscription time, closing the publish-before-subscribe race. Server: revision 0.
   */
  const rev = useSyncExternalStore(subscribeImageManifest, imageManifestRevision, () => 0);
  return rev >= 0 && imageManifestReady();
}
