/**
 * Catalog data-access layer — the taxonomy-rich `catalog.json` published by the
 * tcgscan-data pipeline (card names, set/series structure, image tiers,
 * enrichment facts), behind the `Catalog` interface. All data-shape knowledge
 * (raw snake_case → camelCase normalization, Map-backed lookups) lives here.
 *
 * Shared by michi-maker and tcgscan-app; app-specific view-model adapters
 * (e.g. michi's catalogCardToDemoCard) stay in the apps.
 */
import { useEffect, useState } from 'react';

import { getBrowseUrl, getCatalogSource } from './config';

/** Cards processed per build batch before yielding to the event loop (keeps the UI responsive). */
const BUILD_CHUNK = 4000;
/** Yield a macrotask so pending input/paint can run between build batches. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Real-world size class of a card (drives its pocket footprint in binder UIs). */
export type CardKind = 'standard' | 'jumbo' | 'vunion';

/** A single card from the catalog. `id` is the catalog's stable card id (string). */
export interface CatalogCard {
  id: string;
  name: string;
  number: string; // collector number, e.g. "065/102" ("" for code cards)
  rarity: string;
  cardType: string[];
  setId: string;
  setName: string;
  setCode: string;
  seriesId: string; // series name doubles as its id
  releaseDate: string; // ISO yyyy-mm-dd or ""
  image: string; // full-size image URL (data-server bucket, CDN fallback)
  kind: CardKind; // derived footprint: 'standard' | 'jumbo' | 'vunion'
  // enrichment (present in the hosted catalog; '' / [] when absent)
  illustrator: string;
  types: string[]; // TCG energy types, e.g. ["Fire"]
  stage: string; // Basic | Stage1 | Stage2 | VMAX | …
  hp: number | null; // printed HP, or null when the card has none / it's unknown
  /** Evolution stage, 1-indexed (1 = Basic, 2 = Stage 1, …); -1 when unknown. Bumped from
   *  the pipeline's 0-indexed `evolution_stage_index` so `stage>1` reads as "evolved". */
  evolutionStage: number;
  /** Authoritative "evolves from" species (scraped per-card); '' for basics / unknown. */
  evolvesFrom: string;
  /** The ordered evolution-family species names (lowercase, DFS order); [] when unknown.
   *  Paired with evolutionStage to surface an "evolves to" example (see evolutionNeighbors). */
  evolutionLine: string[];
  // size tiers (245px / 640px webp), when generated for this card
  imageSmall?: string;
  imageMedium?: string;
  /** The displayed image is a CLEAN twin borrowed for an overlay-marked reprint
   *  (WCD/oversize) — visually right, but the real card may carry a stamp, overlay,
   *  or signature the substitute lacks. Detail views surface a caveat. */
  imageSubstituted?: boolean;
  /** Printing language: 'en' (English) | 'ja' (Japanese). Defaults 'en' when a
   *  legacy/EN-only source omits it. Drives the language badge + facet. */
  language: 'en' | 'ja';
}

/**
 * A V-UNION set: four 1×1 catalog pieces that tile a 2×2 block, in
 * [topLeft, topRight, bottomLeft, bottomRight] order.
 */
export interface VUnionGroup {
  base: string; // Pokémon base name, e.g. "Mewtwo"
  label: string; // display label, e.g. "Mewtwo V-UNION"
  pieces: [string, string, string, string]; // catalog card ids, TL, TR, BL, BR
}

export interface CatalogSet {
  id: string;
  name: string;
  code: string;
  seriesId: string;
  cardCount: number;
  coverUri?: string; // official set logo, else undefined (blank tile)
  releaseDate: string; // set launch (earliest card release_date), yyyy-mm-dd or ""
  lastPrinted: string; // latest card release_date in the set
}

export interface CatalogSeries {
  id: string; // == name
  name: string;
  setIds: string[];
  cardCount: number;
  coverUri?: string; // official series logo, else undefined (blank tile)
  releaseDate: string; // newest set's release (for recency sort), yyyy-mm-dd or ""
  firstDate: string; // oldest set's release
}

export interface Catalog {
  listSeries(): CatalogSeries[];
  getSeries(seriesId: string): CatalogSeries | undefined;
  listSets(seriesId: string): CatalogSet[];
  getSet(setId: string): CatalogSet | undefined;
  listCards(setId: string): CatalogCard[];
  getCard(cardId: string): CatalogCard | undefined;
  /** Every set, newest release first (empty dates sink last) — for a recent/upcoming
   *  products feed. Future-dated sets naturally lead the list. */
  allSets(): CatalogSet[];
  /** The newest cards by release date (dateless cards excluded) — for a "new cards"
   *  strip. Capped at `limit`. */
  recentCards(limit?: number): CatalogCard[];
  /** Cards not yet released (releaseDate strictly after `today`, yyyy-mm-dd), soonest
   *  first. Capped at `limit`. */
  upcomingCards(today: string, limit?: number): CatalogCard[];
  /** Cards already released (releaseDate on/before `today`), newest first. Capped at
   *  `limit`. */
  releasedCards(today: string, limit?: number): CatalogCard[];
  /** Every card (stable order) — for structured queries that scan the corpus. */
  listAll(): CatalogCard[];
  /** Every jumbo (oversized, 2×2) card in the catalog. */
  listJumbo(): CatalogCard[];
  /** The V-UNION groups (each four 1×1 pieces tiling a 2×2). */
  vunionGroups(): VUnionGroup[];
  search(query: string, limit?: number): CatalogCard[];
  searchSeries(query: string, limit?: number): CatalogSeries[];
  searchSets(query: string, limit?: number): CatalogSet[];
  readonly cardCount: number;
}

// ---- raw catalog.json shapes (snake_case, as emitted by the pipeline) --------

export interface RawCard {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  card_type?: string[];
  set_id?: number | string;
  set_name?: string;
  set_code?: string;
  series?: string;
  release_date?: string;
  image?: string;
  /** Oversized card, published by the pipeline (true for every card in TCGPlayer's
   *  synthetic "Jumbo Cards" set). The authoritative footprint signal — `kind` below is
   *  a legacy string the slim catalog no longer emits. */
  jumbo?: boolean;
  kind?: string; // legacy: 'standard' | 'jumbo' | 'vunion' (absent from the slim catalog)
  illustrator?: string;
  types?: string[];
  stage?: string;
  hp?: number | null; // printed HP (kept in the browse catalog for hp: queries)
  evolution_stage_index?: number | null; // 0-indexed evolution stage (0 = Basic); null = unknown
  evolves_from?: string; // authoritative "evolves from" species (scrape)
  evolution_line?: string[]; // ordered family species names (lowercase, DFS order)
  image_small?: string; // 245px webp tier (data server)
  image_medium?: string; // 640px webp tier (data server)
  imageSubstituted?: boolean; // image borrowed from a clean twin (may differ; see CatalogCard)
  language?: 'en' | 'ja'; // printing language (combined EN+JP catalog); defaults 'en'
}
export interface RawSet {
  id: number | string;
  name: string;
  code?: string;
  series?: string;
  card_count?: number;
  logo?: string; // set-art logo URL, if matched
  symbol?: string;
}
export interface RawSeries {
  name: string;
  set_ids: (number | string)[];
  card_count?: number;
  logo?: string; // series logo URL, if available
}
export interface RawVUnionGroup {
  base?: string;
  label?: string;
  pieces?: string[];
}
export interface RawCatalog {
  cards: Record<string, RawCard>;
  sets: Record<string, RawSet>;
  series: Record<string, RawSeries>;
  vunionGroups?: RawVUnionGroup[];
}

/**
 * A card's footprint kind. The oversized flag (`jumbo: bool`) is the real signal in
 * today's slim catalog; `raw.kind` is a legacy string kept only so an older fat catalog
 * still resolves. (V-UNION is derived separately from `vunionGroups`, not from here.)
 */
function cardKind(raw: RawCard): CardKind {
  if (raw.jumbo) return 'jumbo';
  return raw.kind === 'jumbo' || raw.kind === 'vunion' ? raw.kind : 'standard';
}

/** Sort key for collector numbers: "12/102" -> 12, "SWSH045" -> 45, "" -> ∞. */
export function numberKey(n: string): number {
  const m = n.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd -> "Mar 2022" (or "" for empty). */
export function formatSetDate(iso: string): string {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] ?? ''} ${y}`.trim();
}

/** "charmeleon" / "mr-mime" -> "Charmeleon" / "Mr Mime". */
function titleCaseSpecies(s: string): string {
  return s
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Best-effort "evolves from / to" for a card. `from` uses the authoritative scraped
 * `evolvesFrom` (falling back to the prior line member); `to` is the NEXT species in the
 * ordered evolution line — an *example* for branching families (Eevee lists several). Both
 * '' when unknown. Driven by evolutionStage (from evolution_stage_index) + evolutionLine.
 */
export function evolutionNeighbors(card: CatalogCard): { from: string; to: string } {
  const line = card.evolutionLine;
  const idx = card.evolutionStage - 1; // 0-based position along a linear line
  const from =
    card.evolvesFrom || (idx >= 1 && line[idx - 1] ? titleCaseSpecies(line[idx - 1]) : '');
  const to = idx >= 0 && line[idx + 1] ? titleCaseSpecies(line[idx + 1]) : '';
  return { from, to };
}

/** A series' active-years label from its first/last set, e.g. "2016–2018" or "2016". */
export function seriesDateRange(s: { firstDate: string; releaseDate: string }): string {
  const y1 = s.firstDate.slice(0, 4);
  const y2 = s.releaseDate.slice(0, 4);
  if (!y1) return y2;
  if (!y2 || y1 === y2) return y1;
  return `${y1}–${y2}`;
}

/** Newest release first; empty dates sink to the bottom; ties broken by name. */
function byReleaseDesc(
  a: { releaseDate: string; name: string },
  b: { releaseDate: string; name: string },
): number {
  return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name);
}

class LocalCatalog implements Catalog {
  private readonly cards = new Map<string, CatalogCard>();
  private readonly cardsBySet = new Map<string, CatalogCard[]>();
  private readonly sets = new Map<string, CatalogSet>();
  private readonly series = new Map<string, CatalogSeries>();
  private readonly all: CatalogCard[] = [];
  private readonly jumbo: CatalogCard[] = [];
  private readonly vunion: VUnionGroup[] = [];
  // Parallel search index: card names pre-lowercased once so name search doesn't
  // re-lowercase ~28k strings on every keystroke.
  private readonly searchIndex: { card: CatalogCard; lc: string }[] = [];

  private constructor() {}

  /**
   * Build the catalog off the main thread's critical path: the ~28k-card loop is chunked
   * with `await`s so it never runs as one long task that freezes the UI (the cold-start
   * jank). `onProgress` reports build fraction (0→1) so a loader can show real progress.
   */
  static async build(raw: RawCatalog, onProgress?: (fraction: number) => void): Promise<LocalCatalog> {
    const self = new LocalCatalog();
    await self.hydrate(raw, onProgress);
    return self;
  }

  private async hydrate(raw: RawCatalog, onProgress?: (fraction: number) => void): Promise<void> {
    // Set-level attributes (name/code/series) are stored ONCE per set, not stamped
    // onto every card — the normalized catalog drops the per-card copies. Build a
    // lookup so each card can derive them from its set_id. `raw_c.set_name ?? …`
    // keeps reading the old fat catalog (which still carries them) unchanged.
    const setMeta = new Map<string, { name: string; code: string; series: string }>();
    for (const raw_s of Object.values(raw.sets)) {
      setMeta.set(String(raw_s.id), {
        name: raw_s.name ?? '',
        code: raw_s.code ?? '',
        series: raw_s.series ?? '',
      });
    }

    // Chunk the heavy card loop, yielding to the event loop between batches so the JS
    // thread stays responsive (input, paint, the search box) while the catalog builds.
    const rawCards = Object.values(raw.cards);
    for (let i = 0; i < rawCards.length; i++) {
      const raw_c = rawCards[i];
      const setId = String(raw_c.set_id ?? '');
      const meta = setMeta.get(setId);
      const card: CatalogCard = {
        id: String(raw_c.id),
        name: raw_c.name ?? '',
        number: raw_c.number ?? '',
        rarity: raw_c.rarity ?? '',
        cardType: raw_c.card_type ?? [],
        setId,
        setName: raw_c.set_name ?? meta?.name ?? '',
        setCode: raw_c.set_code ?? meta?.code ?? '',
        seriesId: raw_c.series ?? meta?.series ?? '',
        releaseDate: raw_c.release_date ?? '',
        image: raw_c.image ?? '',
        kind: cardKind(raw_c),
        illustrator: raw_c.illustrator ?? '',
        types: raw_c.types ?? [],
        stage: raw_c.stage ?? '',
        hp: typeof raw_c.hp === 'number' ? raw_c.hp : null,
        // 0-indexed → 1-indexed (Basic = 1); -1 when the pipeline had no evolution data.
        evolutionStage:
          typeof raw_c.evolution_stage_index === 'number' ? raw_c.evolution_stage_index + 1 : -1,
        evolvesFrom: raw_c.evolves_from ?? '',
        evolutionLine: raw_c.evolution_line ?? [],
        imageSmall: raw_c.image_small,
        imageMedium: raw_c.image_medium,
        imageSubstituted: raw_c.imageSubstituted,
        language: raw_c.language === 'ja' ? 'ja' : 'en',
      };
      this.cards.set(card.id, card);
      this.all.push(card);
      if (card.kind === 'jumbo') this.jumbo.push(card);
      this.searchIndex.push({ card, lc: card.name.toLowerCase() });
      let bucket = this.cardsBySet.get(card.setId);
      if (!bucket) this.cardsBySet.set(card.setId, (bucket = []));
      bucket.push(card);
      if ((i + 1) % BUILD_CHUNK === 0) {
        onProgress?.((i + 1) / rawCards.length);
        await yieldToEventLoop();
      }
    }
    onProgress?.(1);

    // V-UNION groups: keep only well-formed groups whose four piece ids all resolve.
    for (const g of raw.vunionGroups ?? []) {
      const pieces = g.pieces ?? [];
      if (pieces.length !== 4) continue;
      if (!pieces.every((id) => this.cards.has(String(id)))) continue;
      const base = g.base ?? '';
      this.vunion.push({
        base,
        label: g.label ?? `${base} V-UNION`,
        pieces: pieces.map(String) as [string, string, string, string],
      });
    }

    for (const raw_s of Object.values(raw.sets)) {
      const id = String(raw_s.id);
      const cards = this.cardsBySet.get(id) ?? [];
      const dates = cards.map((c) => c.releaseDate).filter(Boolean).sort(); // yyyy-mm-dd sorts lexically
      this.sets.set(id, {
        id,
        name: raw_s.name ?? id,
        code: raw_s.code ?? '',
        seriesId: raw_s.series ?? '',
        cardCount: raw_s.card_count ?? cards.length,
        coverUri: raw_s.logo, // official set logo if matched, else blank
        releaseDate: dates[0] ?? '',
        lastPrinted: dates[dates.length - 1] ?? '',
      });
    }

    for (const raw_series of Object.values(raw.series)) {
      const setIds = (raw_series.set_ids ?? []).map(String);
      const setsInSeries = setIds
        .map((sid) => this.sets.get(sid))
        .filter((s): s is CatalogSet => Boolean(s));
      const setDates = setsInSeries
        .map((s) => s.releaseDate)
        .filter((d): d is string => Boolean(d))
        .sort();
      this.series.set(raw_series.name, {
        id: raw_series.name,
        name: raw_series.name,
        setIds,
        cardCount: raw_series.card_count ?? 0,
        coverUri: raw_series.logo, // dedicated series-art image, else blank
        firstDate: setDates[0] ?? '',
        releaseDate: setDates[setDates.length - 1] ?? '',
      });
    }
  }

  get cardCount(): number {
    return this.all.length;
  }

  listSeries(): CatalogSeries[] {
    return [...this.series.values()].sort(byReleaseDesc);
  }

  getSeries(seriesId: string): CatalogSeries | undefined {
    return this.series.get(seriesId);
  }

  listSets(seriesId: string): CatalogSet[] {
    const series = this.series.get(seriesId);
    if (!series) return [];
    return series.setIds
      .map((id) => this.sets.get(id))
      .filter((s): s is CatalogSet => Boolean(s))
      .sort(byReleaseDesc);
  }

  getSet(setId: string): CatalogSet | undefined {
    return this.sets.get(setId);
  }

  listCards(setId: string): CatalogCard[] {
    return [...(this.cardsBySet.get(setId) ?? [])].sort(
      (a, b) => numberKey(a.number) - numberKey(b.number) || a.name.localeCompare(b.name),
    );
  }

  getCard(cardId: string): CatalogCard | undefined {
    return this.cards.get(cardId);
  }

  allSets(): CatalogSet[] {
    return [...this.sets.values()].sort(byReleaseDesc);
  }

  recentCards(limit = 24): CatalogCard[] {
    return this.all
      .filter((c) => c.releaseDate)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  upcomingCards(today: string, limit = 40): CatalogCard[] {
    return this.all
      .filter((c) => c.releaseDate && c.releaseDate > today)
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  releasedCards(today: string, limit = 40): CatalogCard[] {
    return this.all
      .filter((c) => c.releaseDate && c.releaseDate <= today)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  listAll(): CatalogCard[] {
    return this.all;
  }

  listJumbo(): CatalogCard[] {
    return [...this.jumbo].sort(
      (a, b) => a.name.localeCompare(b.name) || numberKey(a.number) - numberKey(b.number),
    );
  }

  vunionGroups(): VUnionGroup[] {
    return [...this.vunion];
  }

  search(query: string, limit = 60): CatalogCard[] {
    // Full scan over the pre-lowercased index (cheap at ~28k): prefix matches rank
    // first and are never dropped by an early break — we only stop once we already
    // have a full page of prefix hits. `contains` is capped so it can't grow unbounded.
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts: CatalogCard[] = [];
    const contains: CatalogCard[] = [];
    for (const { card, lc } of this.searchIndex) {
      const idx = lc.indexOf(q);
      if (idx < 0) continue;
      if (idx === 0) {
        starts.push(card);
        if (starts.length >= limit) break;
      } else if (contains.length < limit) {
        contains.push(card);
      }
    }
    return [...starts, ...contains].slice(0, limit);
  }

  searchSeries(query: string, limit = 6): CatalogSeries[] {
    return matchByName([...this.series.values()], (s) => s.name, query, limit);
  }

  searchSets(query: string, limit = 12): CatalogSet[] {
    // match a set by its own name or its series name (so "swor" surfaces sets too)
    return matchByName([...this.sets.values()], (s) => `${s.name} ${s.seriesId}`, query, limit, (s) => s.name);
  }
}

/**
 * Prefix-boosted substring match: items whose (rank) text starts with the query
 * come first, then substring hits — capped at `limit`. `rankText` defaults to
 * `text`; pass a narrower one when `text` includes extra searchable context.
 */
function matchByName<T>(
  items: T[],
  text: (t: T) => string,
  query: string,
  limit: number,
  rankText?: (t: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = rankText ?? text;
  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const hay = text(item).toLowerCase();
    if (!hay.includes(q)) continue;
    if (rank(item).toLowerCase().startsWith(q)) starts.push(item);
    else contains.push(item);
    if (starts.length + contains.length >= limit * 3) break; // bound work on huge lists
  }
  return [...starts, ...contains].slice(0, limit);
}

/** catalog.json compresses ~12× (brotli) — used to estimate the decoded total from the
 *  compressed Content-Length so download progress is roughly accurate. */
const BROTLI_RATIO = 12;
/** Fallback decoded-size estimate when there's no Content-Length (chunked/compressed). */
const FALLBACK_TOTAL_BYTES = 9_000_000;
/** Download is the bulk of the wait on a slow link; give it 90% of the bar, the build 10%. */
const DOWNLOAD_FRACTION = 0.9;

async function loadCatalogFrom(base: string): Promise<Catalog> {
  // Gated path: the app supplies the catalog (fetched + decrypted + decoded); we just build it.
  // Its onProgress drives the download portion of the load bar (see DATA-PROTECTION-PLAN.md).
  const source = getCatalogSource();
  if (source) {
    setCatalogStatus('downloading', 0);
    const raw = await source((received, total) => {
      const t = total > 0 ? total : FALLBACK_TOTAL_BYTES;
      setCatalogStatus('downloading', DOWNLOAD_FRACTION * Math.min(received / t, 1), {
        received,
        total: t,
        eta: -1,
      });
    });
    return LocalCatalog.build(raw, (f) =>
      setCatalogStatus('parsing', DOWNLOAD_FRACTION + (1 - DOWNLOAD_FRACTION) * f),
    );
  }
  const res = await fetch(`${base}/catalog.json`);
  if (!res.ok) throw new Error(`Failed to load catalog.json (${res.status})`);
  // Stream the body for real download progress (the slow part on cellular). `res.body` is a
  // ReadableStream on web; React Native fetch has no streaming — fall back to res.json() there.
  const reader = res.body?.getReader?.();
  if (reader && typeof TextDecoder !== 'undefined') {
    // Content-Length is the COMPRESSED size; the reader yields DECODED bytes, so estimate the
    // decoded total via the typical compression ratio (keeps the % + ETA roughly honest).
    const compressed = Number(res.headers.get('content-length')) || 0;
    let total = compressed ? compressed * BROTLI_RATIO : FALLBACK_TOTAL_BYTES;
    const decoder = new TextDecoder();
    const started = Date.now();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      text += decoder.decode(value, { stream: true });
      if (received > total) total = Math.ceil(received / 0.99); // grow past a low estimate
      const elapsed = (Date.now() - started) / 1000;
      const rate = elapsed > 0 ? received / elapsed : 0;
      const eta = rate > 0 ? Math.max(0, Math.round((total - received) / rate)) : -1;
      setCatalogStatus('downloading', DOWNLOAD_FRACTION * Math.min(received / total, 1), {
        received,
        total,
        eta,
      });
    }
    text += decoder.decode();
    const raw = JSON.parse(text) as RawCatalog;
    return LocalCatalog.build(raw, (f) =>
      setCatalogStatus('parsing', DOWNLOAD_FRACTION + (1 - DOWNLOAD_FRACTION) * f, {
        received,
        total,
        eta: 0,
      }),
    );
  }
  // Native / no streaming: one JSON parse, then the chunked build reports its own progress.
  setCatalogStatus('parsing', 0);
  const raw = (await res.json()) as RawCatalog;
  return LocalCatalog.build(raw, (fraction) => setCatalogStatus('parsing', fraction));
}

let cache: Promise<Catalog> | null = null;
let loaded: Catalog | null = null;
const subscribers = new Set<() => void>();

// ---- catalog load status (for progress + server↔on-device search mode indicators) ---------

/**
 * Where the shared catalog is in its lifecycle:
 *  - 'idle'        nothing started
 *  - 'downloading' fetching catalog.json (off-thread)
 *  - 'parsing'     JSON parsed; building the in-memory index in chunks (`progress` = 0→1)
 *  - 'ready'       fully in memory — on-device search/`getCard` available
 *  - 'error'       load failed (a later mount retries)
 * On-device (client) search is available exactly when status === 'ready'.
 */
export type CatalogStatus = 'idle' | 'downloading' | 'parsing' | 'ready' | 'error';

/** A tqdm-style snapshot of the load: phase, overall fraction, bytes, and a rough ETA. */
export interface CatalogLoadStatus {
  status: CatalogStatus;
  /** 0→1 across the WHOLE load (download is ~90%, the in-memory build the last ~10%). */
  progress: number;
  /** Decoded bytes downloaded so far (0 until the streaming download starts). */
  receivedBytes: number;
  /** Estimated decoded total (0 when unknown — e.g. no Content-Length / native fallback). */
  totalBytes: number;
  /** Rough seconds remaining for the download, or -1 when not estimable. */
  etaSeconds: number;
}

let catalogStatus: CatalogStatus = 'idle';
let catalogProgress = 0;
let catalogReceived = 0;
let catalogTotal = 0;
let catalogEta = -1;
const statusListeners = new Set<() => void>();

function setCatalogStatus(
  status: CatalogStatus,
  progress: number,
  bytes?: { received: number; total: number; eta: number },
): void {
  catalogStatus = status;
  catalogProgress = progress;
  catalogReceived = bytes?.received ?? 0;
  catalogTotal = bytes?.total ?? 0;
  catalogEta = bytes?.eta ?? -1;
  statusListeners.forEach((cb) => cb());
}

/** The current catalog load snapshot (phase, fraction, bytes, ETA). Synchronous. */
export function getCatalogStatus(): CatalogLoadStatus {
  return {
    status: catalogStatus,
    progress: catalogProgress,
    receivedBytes: catalogReceived,
    totalBytes: catalogTotal,
    etaSeconds: catalogEta,
  };
}

/** Subscribe to load-phase/progress changes (fires on every phase + download/build tick). */
export function subscribeCatalogStatus(callback: () => void): () => void {
  statusListeners.add(callback);
  return () => {
    statusListeners.delete(callback);
  };
}

/** React helper: re-render on catalog load changes. Returns the snapshot. */
export function useCatalogStatus(): CatalogLoadStatus {
  const [, bump] = useState(0);
  useEffect(() => subscribeCatalogStatus(() => bump((v) => v + 1)), []);
  return getCatalogStatus();
}

/**
 * Subscribe to catalog-loaded notifications. The callback fires once, when the shared
 * catalog finishes loading (i.e. when `getLoadedCatalog()` flips from null to the catalog).
 * Lets components reactively pick up the catalog *without* forcing the fetch themselves.
 * Returns an unsubscribe function.
 */
export function subscribeCatalog(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Shared, load-once catalog: the fetch + parse happens exactly once app-wide
 * (module-level promise cache), regardless of how many callers await it.
 */
export function loadCatalog(): Promise<Catalog> {
  if (!cache) {
    setCatalogStatus('downloading', 0);
    cache = loadCatalogFrom(getBrowseUrl())
      .then((c) => {
        loaded = c; // publish a synchronous snapshot for non-async callers (see getLoadedCatalog)
        setCatalogStatus('ready', 1);
        subscribers.forEach((cb) => cb());
        return c;
      })
      .catch((e) => {
        cache = null; // don't poison the cache — let a later mount retry the fetch
        setCatalogStatus('error', 0);
        throw e;
      });
  }
  return cache;
}

/** Alias of {@link loadCatalog} — the shared, load-once catalog promise. */
export function getCatalog(): Promise<Catalog> {
  return loadCatalog();
}

/**
 * Fire-and-forget, low-priority warm of the shared catalog. Kicks off the load-once
 * fetch/parse without making any caller await it, and swallows errors (on failure
 * `loadCatalog` already clears its cache so a later mount retries).
 */
export function prefetchCatalog(): void {
  loadCatalog().catch(() => {
    // Swallowed on purpose: this is a background warm, not a subscriber. A later
    // useCatalog mount surfaces the error and retries the (now-cleared) cache.
  });
}

/**
 * Synchronous access to the catalog *iff* it has already resolved, else `null`.
 * Lets render-path code read the catalog without awaiting — callers must handle
 * the `null` (still-loading) case with a fallback. Does NOT kick off a load.
 */
export function getLoadedCatalog(): Catalog | null {
  return loaded;
}
