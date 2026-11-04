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
let loadPromise = null;
let snapshot = null;
const registeredSummaries = new Map();
/**
 * Declare another game whose prices belong in the summary. Idempotent, safe at import time, and
 * cheap: it only drops any loaded copy so the next read re-merges.
 *
 * IDS ARE ONE NAMESPACE (TCGplayer productIds) across every game, so a merge cannot collide in
 * practice; where it somehow does, the PRIMARY game wins, because that is the catalog this host is
 * built around.
 */
export function registerPriceSummary(source) {
    if (registeredSummaries.get(source.key)?.browseUrl === source.browseUrl)
        return;
    registeredSummaries.set(source.key, source);
    loadPromise = null; // re-merge on the next read; a good snapshot stays readable until it lands
}
/** '' on any failure: a game whose summary is missing must not cost the others theirs. */
function fetchSummaryAt(browseUrl) {
    return fetch(`${browseUrl}/prices-summary.json`)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
}
/** Load-once summary fetch (shared by every subscriber), primary plus any registered game. */
export function getPriceSummary() {
    if (!loadPromise) {
        const gen = browseGeneration();
        const others = [...registeredSummaries.values()];
        loadPromise = Promise.all([
            fetch(`${getBrowseUrl()}/prices-summary.json`).then((res) => {
                if (!res.ok)
                    throw new Error(`prices-summary ${res.status}`);
                return res.json();
            }),
            ...others.map((o) => fetchSummaryAt(o.browseUrl)),
        ])
            .then(([primary, ...rest]) => {
            // Primary last: it wins a collision, and a secondary can only ever ADD ids.
            const all = rest.length ? Object.assign({}, ...rest, primary) : primary;
            if (isCurrent(gen))
                snapshot = all; // a load from before a game switch publishes nothing
            return all;
        })
            .catch(() => {
            // A failed summary must NOT stick — a cached {} renders every portfolio as $0.00 until the
            // process restarts. Drop the cache so the next call re-fetches, and leave any good snapshot
            // in place. Still resolve empty for THIS call (callers rely on it never throwing).
            if (isCurrent(gen))
                loadPromise = null;
            return {};
        });
    }
    return loadPromise;
}
/**
 * Internal: forget the summary and every per-card price and value series (resetBrowseData).
 * Registered secondary summaries STAY registered: they are the host's declaration of which games
 * it shows, not data.
 */
export function _resetPrices() {
    loadPromise = null;
    snapshot = null;
    cardCache.clear();
    valueSeriesCache.clear();
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
export function setCompactMoney(on) {
    compactMoney = on;
}
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeDollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const scaled = (n, unit, decimals) => `${n.toFixed(decimals).replace(/\.?0+$/, '')}${unit}`;
/**
 * The figure of a dollar amount, without the sign or the $: '1,234.50' or, compact, '1,235',
 * '101.2k', '30.79M'. `compact` defaults to the kit-wide switch. Each step's upper bound is where
 * its rounding would reach the next step, so 999,960 reads 1M, never 1000k.
 */
export function moneyFigure(abs, compact = compactMoney) {
    const n = Math.abs(abs);
    if (!compact || n < 999.995)
        return cents.format(n);
    if (n < 99999.5)
        return wholeDollars.format(n);
    if (n < 999950)
        return scaled(n / 1e3, 'k', 1);
    if (n < 99995000)
        return scaled(n / 1e6, 'M', 2);
    if (n < 999950000)
        return scaled(n / 1e6, 'M', 1);
    if (n < 99995000000)
        return scaled(n / 1e9, 'B', 2);
    if (n < 999950000000)
        return scaled(n / 1e9, 'B', 1);
    return scaled(n / 1e12, 'T', 2);
}
/** "$1,234.56" (en-US), or '' for a zero/absent value; compact when the host turned it on. */
export function formatUsd(value) {
    if (!value)
        return '';
    return `${value < 0 ? '-' : ''}$${moneyFigure(value)}`;
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
    const cached = cardCache.get(productId);
    if (cached)
        return cached;
    const p = (getApiUrl()
        ? fetchCardPricesRest(productId)
        : fetch(`${getBrowseUrl()}/prices/${productId}.json`)
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null)).then((v) => {
        // Never pin a failure: a null here (transport error OR genuine miss) is evicted so the next
        // lookup re-fetches, instead of freezing the card at "$0.00" for the whole process.
        if (v == null)
            cardCache.delete(productId);
        return v;
    });
    cardCache.set(productId, p);
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
    const cached = valueSeriesCache.get(key);
    if (cached)
        return cached;
    const file = kind === 'set' ? `set-${id}` : `series-${valueSeriesSlug(id)}`;
    const p = fetch(`${getBrowseUrl()}/value-series/${file}.json`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((v) => {
        // Don't pin a failed fetch — evict on null so a later view re-fetches (a missing file is a
        // legitimate null too; re-checking it is cheap).
        if (v == null)
            valueSeriesCache.delete(key);
        return v;
    });
    valueSeriesCache.set(key, p);
    return p;
}
