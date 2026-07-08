/**
 * Card price data-access — the latest-value summary from the tcgscan-data
 * server (same origin as the catalog: `${browseUrl}/prices-summary.json`,
 * ~2.7MB, keyed by catalog card id). Load-once and promise-cached like the
 * catalog; loading failures degrade to an empty map so pricing is always
 * optional decoration, never a hard dependency.
 *
 * App-specific aggregations (e.g. michi's binder/page totals) stay in the apps.
 */
import { useEffect, useState } from 'react';

import { getApiKey, getApiUrl, getBrowseUrl } from './config';

/** cardId -> latest headline value. cur = priciest variant's last market price. */
export interface PriceSummaryEntry {
  cur: number;
  date: string; // yyyy-mm-dd of the latest observation
  variants: Record<string, number>;
}
export type PriceSummary = Record<string, PriceSummaryEntry>;

let loadPromise: Promise<PriceSummary> | null = null;
let snapshot: PriceSummary | null = null;

/** Load-once summary fetch (shared by every subscriber). */
export function getPriceSummary(): Promise<PriceSummary> {
  if (!loadPromise) {
    loadPromise = fetch(`${getBrowseUrl()}/prices-summary.json`)
      .then((res) => (res.ok ? (res.json() as Promise<PriceSummary>) : {}))
      .catch(() => ({}))
      .then((s: PriceSummary) => {
        snapshot = s;
        return s;
      });
  }
  return loadPromise;
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

/** "$1,234.56" (en-US), or '' for a zero/absent value. */
export function formatUsd(value: number): string {
  if (!value) return '';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
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
  let p = cardCache.get(productId);
  if (!p) {
    p = getApiUrl()
      ? fetchCardPricesRest(productId)
      : fetch(`${getBrowseUrl()}/prices/${productId}.json`)
          .then((res) => (res.ok ? (res.json() as Promise<CardPrices>) : null))
          .catch(() => null);
    cardCache.set(productId, p);
  }
  return p;
}
