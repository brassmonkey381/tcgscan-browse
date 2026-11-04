/**
 * Card price data-access — the latest-value summary from the tcgscan-data
 * server (same origin as the catalog: `${browseUrl}/prices-summary.json`,
 * ~2.7MB, keyed by catalog card id), plus any other game a host registers
 * (registerPriceSummary). Load-once and promise-cached like the
 * catalog; loading failures degrade to an empty map so pricing is always
 * optional decoration, never a hard dependency.
 *
 * App-specific aggregations (e.g. michi's binder/page totals) stay in the apps.
 */
import { useEffect, useState } from 'react';

import { getApiKey, getApiUrl, getBrowseUrl } from './config';
import { browseGeneration, isCurrent } from './generation';

/** cardId -> latest headline value. cur = priciest variant's last market price. */
export interface PriceSummaryEntry {
  cur: number;
  date: string; // yyyy-mm-dd of the latest observation
  variants: Record<string, number>;
}
export type PriceSummary = Record<string, PriceSummaryEntry>;

let loadPromise: Promise<PriceSummary> | null = null;
let snapshot: PriceSummary | null = null;

// ---- secondary summaries (a host showing more than one game) --------------------------------
//
// Same seam as registerImageManifest in images.ts, and for the same reason: the kit prices cards
// INSIDE itself — `sort:value`, the price filters and the tile prices all read the map below — so a
// host cannot merge a second game's prices in from outside. With none registered, every path here
// is the code that shipped before.
//
// UNLIKE IMAGES, THESE LOAD EAGERLY. A picture is fetched when a card that needs it appears; an
// ordering needs every price BEFORE it sorts. A summary that arrived late would silently sort the
// other game's cards to the bottom at $0, which is exactly the bug this seam exists to end (michi
// locked value sort for its secondary games over it).

export interface SecondaryPriceSummary {
  /** Stable id for this source, e.g. 'onepiece'. Registering the same key twice is a no-op. */
  key: string;
  /** Bucket root holding its `prices-summary.json` (the other game's browseUrl). */
  browseUrl: string;
}

const registeredSummaries = new Map<string, SecondaryPriceSummary>();

/**
 * Declare another game whose prices belong in the summary. Idempotent, safe at import time, and
 * cheap: it only drops any loaded copy so the next read re-merges.
 *
 * IDS ARE ONE NAMESPACE (TCGplayer productIds) across every game, so a merge cannot collide in
 * practice; where it somehow does, the PRIMARY game wins, because that is the catalog this host is
 * built around.
 */
export function registerPriceSummary(source: SecondaryPriceSummary): void {
  if (registeredSummaries.get(source.key)?.browseUrl === source.browseUrl) return;
  registeredSummaries.set(source.key, source);
  loadPromise = null; // re-merge on the next read; a good snapshot stays readable until it lands
}

/** '' on any failure: a game whose summary is missing must not cost the others theirs. */
function fetchSummaryAt(browseUrl: string): Promise<PriceSummary> {
  return fetch(`${browseUrl}/prices-summary.json`)
    .then((res) => (res.ok ? (res.json() as Promise<PriceSummary>) : {}))
    .catch(() => ({}) as PriceSummary);
}

/** Load-once summary fetch (shared by every subscriber), primary plus any registered game. */
export function getPriceSummary(): Promise<PriceSummary> {
  if (!loadPromise) {
    const gen = browseGeneration();
    const others = [...registeredSummaries.values()];
    loadPromise = Promise.all([
      fetch(`${getBrowseUrl()}/prices-summary.json`).then((res) => {
        if (!res.ok) throw new Error(`prices-summary ${res.status}`);
        return res.json() as Promise<PriceSummary>;
      }),
      ...others.map((o) => fetchSummaryAt(o.browseUrl)),
    ])
      .then(([primary, ...rest]: PriceSummary[]) => {
        // Primary last: it wins a collision, and a secondary can only ever ADD ids.
        const all: PriceSummary = rest.length ? Object.assign({}, ...rest, primary) : primary;
        if (isCurrent(gen)) snapshot = all; // a load from before a game switch publishes nothing
        return all;
      })
      .catch(() => {
        // A failed summary must NOT stick — a cached {} renders every portfolio as $0.00 until the
        // process restarts. Drop the cache so the next call re-fetches, and leave any good snapshot
        // in place. Still resolve empty for THIS call (callers rely on it never throwing).
        if (isCurrent(gen)) loadPromise = null;
        return {} as PriceSummary;
      });
  }
  return loadPromise;
}

/**
 * Internal: forget the summary and every per-card price and value series (resetBrowseData).
 * Registered secondary summaries STAY registered: they are the host's declaration of which games
 * it shows, not data.
 */
export function _resetPrices(): void {
  loadPromise = null;
  snapshot = null;
  cardCache.clear();
  valueSeriesCache.clear();
}

/** Synchronous view of the summary once loaded (null before). Lets pure helpers
 *  read prices without threading state. */
export function priceSnapshot(): PriceSummary | null {
  return snapshot;
}

/** The summary map, or null while loading. Never throws — {} on failure. */
export function usePriceSummary(): PriceSummary | null {
  const [summary, setSummary] = useState<PriceSummary | null>(null);
  useEffect(() => {
    let mounted = true;
    getPriceSummary().then((s) => {
      if (mounted) setSummary(s);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return summary;
}

/*
  COMPACT MONEY (tcgscan-app owner, 2026-11-03: "no money values ever get too big and move UI
  around"). With it on, a dollar figure is never wider than seven characters, so a price tag or a
  column keeps its width whatever the amount:

    999.99    -> 999.99      cents under $1,000
    1,234.5   -> 1,235       whole dollars to $99,999
    101,201   -> 101.2k      thousands, one decimal, to $999.9k
    1,234,567 -> 1.23M       millions, two decimals to $99.99M, then one
    30,789,123 -> 30.79M
    the same steps for B and T; trailing zeros dropped (100k, 1M, 30.7M)

  A host turns it on with setCompactMoney (tcgscan-app does, from its settings); off, every figure
  keeps its cents, as before. Off by default so a host that never asks (michi-maker) is unchanged.
*/
let compactMoney = false;

/** Turn compact money on or off for every figure the kit writes (formatUsd, moneyFigure). */
export function setCompactMoney(on: boolean): void {
  compactMoney = on;
}

const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeDollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const scaled = (n: number, unit: string, decimals: number) =>
  `${n.toFixed(decimals).replace(/\.?0+$/, '')}${unit}`;

/**
 * The figure of a dollar amount, without the sign or the $: '1,234.50' or, compact, '1,235',
 * '101.2k', '30.79M'. `compact` defaults to the kit-wide switch. Each step's upper bound is where
 * its rounding would reach the next step, so 999,960 reads 1M, never 1000k.
 */
export function moneyFigure(abs: number, compact = compactMoney): string {
  const n = Math.abs(abs);
  if (!compact || n < 999.995) return cents.format(n);
  if (n < 99_999.5) return wholeDollars.format(n);
  if (n < 999_950) return scaled(n / 1e3, 'k', 1);
  if (n < 99_995_000) return scaled(n / 1e6, 'M', 2);
  if (n < 999_950_000) return scaled(n / 1e6, 'M', 1);
  if (n < 99_995_000_000) return scaled(n / 1e9, 'B', 2);
  if (n < 999_950_000_000) return scaled(n / 1e9, 'B', 1);
  return scaled(n / 1e12, 'T', 2);
}

/** "$1,234.56" (en-US), or '' for a zero/absent value; compact when the host turned it on. */
export function formatUsd(value: number): string {
  if (!value) return '';
  return `${value < 0 ? '-' : ''}$${moneyFigure(value)}`;
}

// ---- per-card price history --------------------------------------------------
//
// The full per-variant series for one card, for analytics + value-over-time.
// Hosted mode queries the data server's PostgREST `prices` table (always
// current); static mode falls back to `${browseUrl}/prices/<id>.json`.

/** One observation. m = market price, a = avg sales price, q = listing quantity. */
export interface PricePoint {
  d: string; // yyyy-mm-dd
  m: number | null;
  a: number | null;
  q: number;
}

export interface CardPrices {
  productId: string;
  variants: Record<string, PricePoint[]>; // each ascending by date
}

export type TimeRange = '1M' | '3M' | '6M' | '1Y' | 'ALL';
export const TIME_RANGES: TimeRange[] = ['1M', '3M', '6M', '1Y', 'ALL'];

const RANGE_MONTHS: Record<Exclude<TimeRange, 'ALL'>, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };

/** yyyy-mm-dd cutoff for a range, or '' for ALL. String compare is date-safe here. */
export function rangeCutoff(range: TimeRange): string {
  if (range === 'ALL') return '';
  const d = new Date();
  d.setMonth(d.getMonth() - RANGE_MONTHS[range]);
  return d.toISOString().slice(0, 10);
}

/** Keep only points on/after the range cutoff (already date-sorted ascending). */
export function windowByRange(points: PricePoint[], range: TimeRange): PricePoint[] {
  const cutoff = rangeCutoff(range);
  return cutoff ? points.filter((p) => p.d >= cutoff) : points;
}

/** Most recent non-null market price in a series. */
export function lastMarket(points: PricePoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].m !== null) return points[i].m;
  }
  return null;
}

/** Variant names for a card, ordered by current value (priciest first). */
export function orderedVariants(prices: CardPrices): string[] {
  return Object.keys(prices.variants).sort(
    (a, b) => (lastMarket(prices.variants[b]) ?? 0) - (lastMarket(prices.variants[a]) ?? 0),
  );
}

/** % change from the first to the last market point in a (windowed) series. */
export function pctChange(points: PricePoint[]): number | null {
  const first = points.find((p) => p.m !== null)?.m ?? null;
  const last = lastMarket(points);
  if (first == null || last == null || first === 0) return null;
  return ((last - first) / first) * 100;
}

/** PostgREST prices row (hosted mode). */
interface PriceRow {
  date: string;
  variant: string;
  market_price: number | null;
  avg_sales_price: number | null;
  quantity: number | null;
}

function fetchCardPricesRest(productId: string): Promise<CardPrices | null> {
  const params =
    `product_id=eq.${encodeURIComponent(productId)}` +
    `&select=date,variant,market_price,avg_sales_price,quantity&order=date.asc`;
  return fetch(`${getApiUrl()}/prices?${params}`, { headers: { apikey: getApiKey() } })
    .then((res) => (res.ok ? (res.json() as Promise<PriceRow[]>) : null))
    .then((rows) => {
      if (!rows || rows.length === 0) return null;
      const variants: Record<string, PricePoint[]> = {};
      for (const r of rows) {
        (variants[r.variant] ??= []).push({ d: r.date, m: r.market_price, a: r.avg_sales_price, q: r.quantity ?? 0 });
      }
      return { productId, variants };
    })
    .catch(() => null);
}

const cardCache = new Map<string, Promise<CardPrices | null>>();

/** Full price history for one card, or null if unpriced. Cached per productId. */
export function getCardPrices(productId: string): Promise<CardPrices | null> {
  const cached = cardCache.get(productId);
  if (cached) return cached;
  const p = (
    getApiUrl()
      ? fetchCardPricesRest(productId)
      : fetch(`${getBrowseUrl()}/prices/${productId}.json`)
          .then((res) => (res.ok ? (res.json() as Promise<CardPrices>) : null))
          .catch(() => null)
  ).then((v) => {
    // Never pin a failure: a null here (transport error OR genuine miss) is evicted so the next
    // lookup re-fetches, instead of freezing the card at "$0.00" for the whole process.
    if (v == null) cardCache.delete(productId);
    return v;
  });
  cardCache.set(productId, p);
  return p;
}

// ---- precomputed set/series value-over-time ----------------------------------
//
// The pipeline publishes a per-set / per-series total-value time series to
// `${browseUrl}/value-series/set-<id>.json` and `series-<slug>.json`, so the app
// fetches ONE small file per analytics view instead of fanning out a price-history
// request per card. Missing file (older data) -> null, so callers fall back to the
// client-side aggregate.

export type ValueSeriesKind = 'set' | 'series';
/** One total-value observation for a set/series (matches analytics' ValuePoint). */
export interface ValueSeriesPoint {
  d: string; // yyyy-mm-dd
  v: number;
}

/** Series-name → filename slug, matching the pipeline's set_art._slug. */
function valueSeriesSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

const valueSeriesCache = new Map<string, Promise<ValueSeriesPoint[] | null>>();

/** Precomputed value-over-time for a set or series, or null if not published yet. */
export function getValueSeries(kind: ValueSeriesKind, id: string): Promise<ValueSeriesPoint[] | null> {
  const key = `${kind}:${id}`;
  const cached = valueSeriesCache.get(key);
  if (cached) return cached;
  const file = kind === 'set' ? `set-${id}` : `series-${valueSeriesSlug(id)}`;
  const p = fetch(`${getBrowseUrl()}/value-series/${file}.json`)
    .then((res) => (res.ok ? (res.json() as Promise<ValueSeriesPoint[]>) : null))
    .catch(() => null)
    .then((v) => {
      // Don't pin a failed fetch — evict on null so a later view re-fetches (a missing file is a
      // legitimate null too; re-checking it is cheap).
      if (v == null) valueSeriesCache.delete(key);
      return v;
    });
  valueSeriesCache.set(key, p);
  return p;
}
