/**
 * Catalog data-access layer — the taxonomy-rich `catalog.json` published by the
 * tcgscan-data pipeline (card names, set/series structure, image tiers,
 * enrichment facts), behind the `Catalog` interface. All data-shape knowledge
 * (raw snake_case → camelCase normalization, Map-backed lookups) lives here.
 *
 * Shared by michi-maker and tcgscan-app; app-specific view-model adapters
 * (e.g. michi's catalogCardToDemoCard) stay in the apps.
 */
import { getBrowseUrl } from './config';

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
  // size tiers (245px / 640px webp), when generated for this card
  imageSmall?: string;
  imageMedium?: string;
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
  kind?: string; // 'standard' | 'jumbo' | 'vunion'
  illustrator?: string;
  types?: string[];
  stage?: string;
  image_small?: string; // 245px webp tier (data server)
  image_medium?: string; // 640px webp tier (data server)
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

/** Coerce a raw kind string into a valid CardKind, defaulting to 'standard'. */
function normalizeKind(raw?: string): CardKind {
  return raw === 'jumbo' || raw === 'vunion' ? raw : 'standard';
}

/** Sort key for collector numbers: "12/102" -> 12, "SWSH045" -> 45, "" -> ∞. */
function numberKey(n: string): number {
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

  constructor(raw: RawCatalog) {
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

    for (const raw_c of Object.values(raw.cards)) {
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
        kind: normalizeKind(raw_c.kind),
        illustrator: raw_c.illustrator ?? '',
        types: raw_c.types ?? [],
        stage: raw_c.stage ?? '',
        imageSmall: raw_c.image_small,
        imageMedium: raw_c.image_medium,
      };
      this.cards.set(card.id, card);
      this.all.push(card);
      if (card.kind === 'jumbo') this.jumbo.push(card);
      this.searchIndex.push({ card, lc: card.name.toLowerCase() });
      let bucket = this.cardsBySet.get(card.setId);
      if (!bucket) this.cardsBySet.set(card.setId, (bucket = []));
      bucket.push(card);
    }

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

async function loadCatalogFrom(base: string): Promise<Catalog> {
  const res = await fetch(`${base}/catalog.json`);
  if (!res.ok) throw new Error(`Failed to load catalog.json (${res.status})`);
  return new LocalCatalog((await res.json()) as RawCatalog);
}

let cache: Promise<Catalog> | null = null;
let loaded: Catalog | null = null;
const subscribers = new Set<() => void>();

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
    cache = loadCatalogFrom(getBrowseUrl())
      .then((c) => {
        loaded = c; // publish a synchronous snapshot for non-async callers (see getLoadedCatalog)
        subscribers.forEach((cb) => cb());
        return c;
      })
      .catch((e) => {
        cache = null; // don't poison the cache — let a later mount retry the fetch
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
