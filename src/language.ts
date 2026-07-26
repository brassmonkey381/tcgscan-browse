/**
 * The shared EN/JP printing-language preference — ONE value every browse surface reads.
 *
 * The kit already accepted a per-instance `languages` prop (CatalogBrowser / RecentProducts).
 * That covers "this browser shows EN only", but it can't express "this USER wants no Japanese
 * results anywhere", because a card-similarity or colour search fired from inside the browser,
 * or from an app's own colour sheet, is a separate call with its own arguments. So the choice
 * lives here, at module scope, and every search path in the kit reads it.
 *
 * Why it matters that this is a PRE-filter, not a post-filter: the similarity and colour RPCs
 * rank the whole EN+JP corpus and return a top-N. Filtering that top-N client-side throws away
 * most of a page (measured: 46.7% of an EN card's 24 nearest neighbours are JP printings, so an
 * EN-only browser rendered ~13 of 24). Passing the bound to the server instead cuts the corpus
 * BEFORE the top-N, so a constrained search returns a FULL page. See tcgscan-data migration 33.
 *
 * Persistence is the APP's business (the kit has no storage and no auth): pass a `languageStore`
 * to `configureBrowse` and the kit hydrates from it once and writes through on every change.
 * Fail-soft — a missing or throwing store just means the preference is session-only.
 */
import { useCallback, useSyncExternalStore } from 'react';

import type { CardLanguage } from './catalog';
import { getLanguageStore } from './config';

/** Canonical order — a stored/derived value is always re-sorted into this, so identity is stable
 *  regardless of the order the user tapped the pills in. */
export const LANGUAGE_ORDER: CardLanguage[] = ['en', 'ja'];

/** Display label for a printing language (also the `language` facet's chip values). */
export function languageLabel(code: CardLanguage): string {
  return code === 'ja' ? 'Japanese' : 'English';
}

/** Short label for the toggle pills. */
export function languageShortLabel(code: CardLanguage): string {
  return code === 'ja' ? 'JP' : 'EN';
}

/**
 * Default = BOTH languages, i.e. unconstrained. This deliberately matches what the kit did
 * before the shared store existed (`languages` undefined meant "all"), so simply upgrading the
 * package never silently hides a language from an app that hasn't opted in.
 */
const DEFAULT: CardLanguage[] = ['en', 'ja'];

/** Canonical order, valid codes only, never empty — a surface constrained to nothing shows
 *  nothing, which reads as a broken app rather than a filter. */
export function normalizeLanguages(v: unknown): CardLanguage[] {
  const arr = Array.isArray(v) ? v : [];
  const picked = LANGUAGE_ORDER.filter((c) => arr.includes(c));
  return picked.length ? picked : DEFAULT;
}

function same(a: CardLanguage[], b: CardLanguage[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

// Module-level store so every consumer resolves to ONE value AND one identity between renders
// (useSyncExternalStore requires a stable snapshot unless the value actually changed).
let current: CardLanguage[] = DEFAULT;
const listeners = new Set<() => void>();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot(): CardLanguage[] {
  return current;
}

/** The current EN/JP preference. Safe to call outside React (the clients read it this way). */
export function getBrowseLanguages(): CardLanguage[] {
  return current;
}

/**
 * Set the preference and persist it through the configured `languageStore`. Pass
 * `{ persist: false }` when ADOPTING an external value (hydration, an account profile arriving)
 * so the kit doesn't echo it straight back to storage.
 */
export function setBrowseLanguages(next: CardLanguage[], opts: { persist?: boolean } = {}): void {
  const norm = normalizeLanguages(next);
  if (same(norm, current)) return; // no-op keeps the snapshot identity stable
  current = norm;
  if (opts.persist !== false) {
    try {
      getLanguageStore()?.save?.(norm);
    } catch {
      // storage is best-effort; the in-memory value still stands for this session
    }
  }
  listeners.forEach((l) => l());
}

/** Subscribe to preference changes (non-React callers). Returns an unsubscribe. */
export function subscribeBrowseLanguages(callback: () => void): () => void {
  return subscribe(callback);
}

let hydrated = false;

/**
 * Load the persisted preference through the app-supplied store, once per session. Called
 * automatically by `useBrowseLanguages`; call it directly if a non-React surface needs the
 * stored value early. Adopting does NOT write back.
 */
export async function hydrateBrowseLanguages(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = await getLanguageStore()?.load?.();
    if (stored) setBrowseLanguages(stored, { persist: false });
  } catch {
    // absent / corrupt / offline — the default stands
  }
}

/**
 * The shared EN/JP preference and a setter, as a hook. Every caller shares one value, so a
 * toggle rendered in a header updates a browser elsewhere on the page.
 */
export function useBrowseLanguages(): [CardLanguage[], (v: CardLanguage[]) => void] {
  const langs = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Hydration is idempotent and cheap after the first call; running it from the hook means an
  // app opts into persistence purely by configuring a store.
  void hydrateBrowseLanguages();
  const set = useCallback((v: CardLanguage[]) => setBrowseLanguages(v), []);
  return [langs, set];
}

/**
 * Resolve the effective language bound for a search call: an explicit per-call/per-instance
 * value wins, otherwise the shared preference. Returns `undefined` when the result is
 * unconstrained (both languages), so callers omit the argument entirely and the server takes
 * its cheaper unbounded path.
 */
export function effectiveLanguages(explicit?: CardLanguage[]): CardLanguage[] | undefined {
  // An explicit EMPTY array means "nothing qualifies" (a contradictory bound, e.g. the EN/JP
  // toggle on English while the Language facet chip asks for Japanese). It must pass through as
  // an empty bound, NOT fall through to the shared preference — the server reads `p_lang '{}'`
  // as no rows, which is the honest answer. Only `undefined` means "no opinion, inherit".
  if (explicit && explicit.length === 0) return [];
  const langs = explicit?.length ? normalizeLanguages(explicit) : current;
  return langs.length >= LANGUAGE_ORDER.length ? undefined : langs;
}
