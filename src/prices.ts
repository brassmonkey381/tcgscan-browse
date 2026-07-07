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

import { getBrowseUrl } from './config';

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
