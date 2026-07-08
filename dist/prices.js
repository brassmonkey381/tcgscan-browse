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
let loadPromise = null;
let snapshot = null;
/** Load-once summary fetch (shared by every subscriber). */
export function getPriceSummary() {
    if (!loadPromise) {
        loadPromise = fetch(`${getBrowseUrl()}/prices-summary.json`)
            .then((res) => (res.ok ? res.json() : {}))
            .catch(() => ({}))
            .then((s) => {
            snapshot = s;
            return s;
        });
    }
    return loadPromise;
}
/** Synchronous view of the summary once loaded (null before). Lets pure helpers
 *  read prices without threading state. */
export function priceSnapshot() {
    return snapshot;
}
/** The summary map, or null while loading. Never throws — {} on failure. */
export function usePriceSummary() {
    const [summary, setSummary] = useState(null);
    useEffect(() => {
        let mounted = true;
        getPriceSummary().then((s) => {
            if (mounted)
                setSummary(s);
        });
        return () => {
            mounted = false;
        };
    }, []);
    return summary;
}
/** "$1,234.56" (en-US), or '' for a zero/absent value. */
export function formatUsd(value) {
    if (!value)
        return '';
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
export const TIME_RANGES = ['1M', '3M', '6M', '1Y', 'ALL'];
const RANGE_MONTHS = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
/** yyyy-mm-dd cutoff for a range, or '' for ALL. String compare is date-safe here. */
export function rangeCutoff(range) {
    if (range === 'ALL')
        return '';
    const d = new Date();
    d.setMonth(d.getMonth() - RANGE_MONTHS[range]);
    return d.toISOString().slice(0, 10);
}
/** Keep only points on/after the range cutoff (already date-sorted ascending). */
export function windowByRange(points, range) {
    const cutoff = rangeCutoff(range);
    return cutoff ? points.filter((p) => p.d >= cutoff) : points;
}
/** Most recent non-null market price in a series. */
export function lastMarket(points) {
    for (let i = points.length - 1; i >= 0; i--) {
        if (points[i].m !== null)
            return points[i].m;
    }
    return null;
}
/** Variant names for a card, ordered by current value (priciest first). */
export function orderedVariants(prices) {
    return Object.keys(prices.variants).sort((a, b) => (lastMarket(prices.variants[b]) ?? 0) - (lastMarket(prices.variants[a]) ?? 0));
}
/** % change from the first to the last market point in a (windowed) series. */
export function pctChange(points) {
    const first = points.find((p) => p.m !== null)?.m ?? null;
    const last = lastMarket(points);
    if (first == null || last == null || first === 0)
        return null;
    return ((last - first) / first) * 100;
}
function fetchCardPricesRest(productId) {
    const params = `product_id=eq.${encodeURIComponent(productId)}` +
        `&select=date,variant,market_price,avg_sales_price,quantity&order=date.asc`;
    return fetch(`${getApiUrl()}/prices?${params}`, { headers: { apikey: getApiKey() } })
        .then((res) => (res.ok ? res.json() : null))
        .then((rows) => {
        var _a;
        if (!rows || rows.length === 0)
            return null;
        const variants = {};
        for (const r of rows) {
            (variants[_a = r.variant] ?? (variants[_a] = [])).push({ d: r.date, m: r.market_price, a: r.avg_sales_price, q: r.quantity ?? 0 });
        }
        return { productId, variants };
    })
        .catch(() => null);
}
const cardCache = new Map();
/** Full price history for one card, or null if unpriced. Cached per productId. */
export function getCardPrices(productId) {
    let p = cardCache.get(productId);
    if (!p) {
        p = getApiUrl()
            ? fetchCardPricesRest(productId)
            : fetch(`${getBrowseUrl()}/prices/${productId}.json`)
                .then((res) => (res.ok ? res.json() : null))
                .catch(() => null);
        cardCache.set(productId, p);
    }
    return p;
}
/** Series-name → filename slug, matching the pipeline's set_art._slug. */
function valueSeriesSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
const valueSeriesCache = new Map();
/** Precomputed value-over-time for a set or series, or null if not published yet. */
export function getValueSeries(kind, id) {
    const key = `${kind}:${id}`;
    let p = valueSeriesCache.get(key);
    if (!p) {
        const file = kind === 'set' ? `set-${id}` : `series-${valueSeriesSlug(id)}`;
        p = fetch(`${getBrowseUrl()}/value-series/${file}.json`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null);
        valueSeriesCache.set(key, p);
    }
    return p;
}
