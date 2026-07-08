import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Catalog analytics — value insight over the tcgscan-data corpus, shared by both
 * apps (toggled on where wanted; see CatalogBrowser's `analytics` prop).
 *
 * `SetAnalytics` / `SeriesAnalytics` render the same value view (tiles: total /
 * priced count / avg; a top-K cards-by-value bar chart colored by rarity; and
 * value-over-time) over a set's or a whole series' cards. `PriceChart` is the
 * per-card price-history chart (variant toggle + range). `ValueOverTimeChart` is
 * the shared presentational line chart.
 *
 * These live in the package alongside the browser, so navigation and theming are
 * INJECTED, not imported: the package never pulls a router or an app theme. Colors
 * come from a `BrowseTheme` (default light); cards open via `onOpenCard(cardId)`.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { getCardPrices, orderedVariants, rangeCutoff, TIME_RANGES, usePriceSummary, } from './prices';
import { lightTheme, RARITY_PALETTE } from './theme';
const TOP_K = [10, 20, 30, 50, 0]; // 0 = All
function money(n) {
    if (n >= 1000)
        return `$${(n / 1000).toFixed(1)}k`;
    return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}
/** All priced cards in a set of cards, sorted priciest-first, using the summary map. */
function pricedCards(cards, summary) {
    if (!summary)
        return [];
    return cards
        .map((card) => ({ card, value: summary[card.id]?.cur }))
        .filter((p) => p.value != null)
        .sort((a, b) => b.value - a.value);
}
/** Set-level value analytics. `onOpenCard` navigates (app-supplied). */
export function SetAnalytics({ catalog, setId, onOpenCard, theme = lightTheme, }) {
    const summary = usePriceSummary();
    const priced = useMemo(() => pricedCards(catalog.listCards(setId), summary), [catalog, summary, setId]);
    return _jsx(ValueAnalytics, { priced: priced, ready: !!summary, onOpenCard: onOpenCard, theme: theme });
}
/** Series-level value analytics — the same view over every card in the series. */
export function SeriesAnalytics({ catalog, seriesId, onOpenCard, theme = lightTheme, }) {
    const summary = usePriceSummary();
    const cards = useMemo(() => catalog.listSets(seriesId).flatMap((s) => catalog.listCards(s.id)), [catalog, seriesId]);
    const priced = useMemo(() => pricedCards(cards, summary), [cards, summary]);
    return _jsx(ValueAnalytics, { priced: priced, ready: !!summary, onOpenCard: onOpenCard, theme: theme });
}
/** The shared value view (tiles, top-K bars, legend, value-over-time). */
function ValueAnalytics({ priced, ready, onOpenCard, theme, }) {
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const rarityColor = useMemo(() => {
        const map = new Map();
        for (const p of priced) {
            const r = p.card.rarity || 'Unknown';
            if (!map.has(r))
                map.set(r, RARITY_PALETTE[map.size % RARITY_PALETTE.length]);
        }
        return map;
    }, [priced]);
    const [k, setK] = useState(20);
    if (!ready)
        return _jsx(ActivityIndicator, { style: { marginTop: 24 } });
    if (!priced.length)
        return _jsx(Text, { style: styles.empty, children: "No price data here yet." });
    const total = priced.reduce((s, p) => s + p.value, 0);
    const top = priced[0];
    const avg = total / priced.length;
    const shown = k === 0 ? priced : priced.slice(0, k);
    const maxVal = top.value;
    return (_jsxs(View, { style: styles.wrap, children: [_jsxs(View, { style: styles.tiles, children: [_jsx(Tile, { styles: styles, label: "Total value", value: money(total) }), _jsx(Tile, { styles: styles, label: "Priced cards", value: `${priced.length}` }), _jsx(Tile, { styles: styles, label: "Avg card", value: money(avg) })] }), _jsxs(Pressable, { style: styles.topCard, onPress: () => onOpenCard(top.card.id), children: [_jsx(Text, { style: styles.topLabel, children: "Most valuable" }), _jsx(Text, { style: styles.topName, numberOfLines: 1, children: top.card.name }), _jsx(Text, { style: styles.topVal, children: money(top.value) })] }), _jsxs(View, { style: styles.sectionHead, children: [_jsx(Text, { style: styles.sectionTitle, children: "Top cards by value" }), _jsx(View, { style: styles.kRow, children: TOP_K.map((opt) => {
                            const on = opt === k;
                            return (_jsx(Pressable, { onPress: () => setK(opt), style: [styles.kChip, on && styles.kChipOn], children: _jsx(Text, { style: [styles.kChipText, on && styles.kChipTextOn], children: opt === 0 ? 'All' : opt }) }, opt));
                        }) })] }), _jsx(View, { style: styles.bars, children: shown.map((p, i) => (_jsxs(Pressable, { style: styles.barRow, onPress: () => onOpenCard(p.card.id), children: [_jsxs(Text, { style: styles.barName, numberOfLines: 1, children: [i + 1, ". ", p.card.name] }), _jsxs(View, { style: styles.barTrack, children: [_jsx(View, { style: [
                                        styles.barFill,
                                        { width: `${Math.max(2, (p.value / maxVal) * 100)}%`, backgroundColor: rarityColor.get(p.card.rarity || 'Unknown') },
                                    ] }), _jsx(Text, { style: styles.barVal, children: money(p.value) })] })] }, p.card.id))) }), _jsx(View, { style: styles.legend, children: [...rarityColor.entries()].map(([r, c]) => (_jsxs(View, { style: styles.legendItem, children: [_jsx(View, { style: [styles.swatch, { backgroundColor: c }] }), _jsx(Text, { style: styles.legendText, children: r })] }, r))) }), _jsx(AggregateValueOverTime, { priced: priced, theme: theme })] }));
}
function Tile({ styles, label, value }) {
    return (_jsxs(View, { style: styles.tile, children: [_jsx(Text, { style: styles.tileValue, children: value }), _jsx(Text, { style: styles.tileLabel, children: label })] }));
}
// --- aggregate value over time (lazy) ----------------------------------------
/** Sum the priciest variant of every priced card by date → one value-over-time series. */
function AggregateValueOverTime({ priced, theme }) {
    const [series, setSeries] = useState(null);
    useEffect(() => {
        let on = true;
        setSeries(null);
        Promise.all(priced.map((p) => getCardPrices(p.card.id))).then((all) => {
            if (!on)
                return;
            const byDate = new Map();
            for (const p of all) {
                if (!p)
                    continue;
                const v = orderedVariants(p)[0];
                for (const pt of p.variants[v] ?? []) {
                    if (pt.m != null)
                        byDate.set(pt.d, (byDate.get(pt.d) ?? 0) + pt.m);
                }
            }
            setSeries([...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, v })));
        });
        return () => {
            on = false;
        };
    }, [priced]);
    return (_jsx(ValueOverTimeChart, { title: "Value over time", series: series, loadingLabel: `aggregating ${priced.length} cards…`, theme: theme }));
}
// --- per-card price history ---------------------------------------------------
/**
 * One card's price history: a variant toggle (priciest variant first) over the shared
 * value-over-time chart. Cards open here in the action sheet; this is the detail chart.
 */
export function PriceChart({ cardId, theme = lightTheme }) {
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const [prices, setPrices] = useState(undefined);
    const [variant, setVariant] = useState(null);
    useEffect(() => {
        let on = true;
        setPrices(undefined);
        setVariant(null);
        getCardPrices(cardId).then((p) => {
            if (!on)
                return;
            setPrices(p);
            setVariant(p ? orderedVariants(p)[0] ?? null : null);
        });
        return () => {
            on = false;
        };
    }, [cardId]);
    const variants = prices ? orderedVariants(prices) : [];
    const points = prices && variant ? prices.variants[variant] ?? [] : [];
    const series = useMemo(() => {
        if (prices === undefined)
            return null; // loading
        return points.filter((p) => p.m != null).map((p) => ({ d: p.d, v: p.m }));
    }, [prices, points]);
    if (prices === null)
        return _jsx(Text, { style: styles.empty, children: "No price history for this card." });
    return (_jsxs(View, { style: styles.wrap, children: [variants.length > 1 ? (_jsx(View, { style: styles.kRow, children: variants.map((v) => {
                    const on = v === variant;
                    return (_jsx(Pressable, { onPress: () => setVariant(v), style: [styles.kChip, on && styles.kChipOn], children: _jsx(Text, { style: [styles.kChipText, on && styles.kChipTextOn], children: v }) }, v));
                }) })) : null, _jsx(ValueOverTimeChart, { title: variant ?? 'Price', series: series, theme: theme })] }));
}
const H = 180;
const PAD = { top: 10, right: 12, bottom: 20, left: 48 };
/** Presentational value-over-time line chart. `series` null = still loading. */
export function ValueOverTimeChart({ title, series, loadingLabel, theme = lightTheme, }) {
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const [range, setRange] = useState('1Y');
    const [width, setWidth] = useState(0);
    const windowed = useMemo(() => {
        if (!series)
            return [];
        const cutoff = rangeCutoff(range);
        return cutoff ? series.filter((p) => p.d >= cutoff) : series;
    }, [series, range]);
    const chart = useMemo(() => {
        if (!width || windowed.length < 2)
            return null;
        const innerW = width - PAD.left - PAD.right;
        const innerH = H - PAD.top - PAD.bottom;
        const vals = windowed.map((p) => p.v);
        let min = Math.min(...vals);
        let max = Math.max(...vals);
        if (min === max)
            max += 1;
        const pad = (max - min) * 0.08;
        min -= pad;
        max += pad;
        const n = windowed.length;
        const x = (i) => PAD.left + (i / (n - 1)) * innerW;
        const y = (v) => PAD.top + (1 - (v - min) / (max - min)) * innerH;
        let d = '';
        windowed.forEach((p, i) => (d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`));
        const area = `${d}L${x(n - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)}L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)}Z`;
        return { d, area, ticks: [max - pad, (min + max) / 2, min + pad], y };
    }, [width, windowed]);
    const onLayout = (e) => setWidth(e.nativeEvent.layout.width);
    const current = windowed.length ? windowed[windowed.length - 1].v : null;
    return (_jsxs(View, { style: styles.chartWrap, children: [_jsxs(View, { style: styles.chartHead, children: [_jsx(Text, { style: styles.chartTitle, children: title }), current != null ? _jsx(Text, { style: styles.chartCur, children: money(current) }) : null] }), _jsx(View, { onLayout: onLayout, style: { width: '100%' }, children: series == null ? (_jsxs(View, { style: [styles.chartState, { height: H }], children: [_jsx(ActivityIndicator, {}), loadingLabel ? _jsx(Text, { style: styles.chartHint, children: loadingLabel }) : null] })) : chart ? (_jsxs(Svg, { width: width, height: H, children: [_jsx(Defs, { children: _jsxs(LinearGradient, { id: "votfill", x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx(Stop, { offset: "0", stopColor: theme.accent, stopOpacity: 0.22 }), _jsx(Stop, { offset: "1", stopColor: theme.accent, stopOpacity: 0 })] }) }), chart.ticks.map((t, i) => (_jsx(SvgText, { x: PAD.left - 6, y: chart.y(t) + 3, fontSize: 9, fill: theme.subtext, textAnchor: "end", children: money(t) }, i))), _jsx(Path, { d: chart.area, fill: "url(#votfill)" }), _jsx(Path, { d: chart.d, stroke: theme.accent, strokeWidth: 2, fill: "none", strokeLinejoin: "round" })] })) : (_jsx(View, { style: [styles.chartState, { height: H }], children: _jsx(Text, { style: styles.chartHint, children: "Not enough data for this range" }) })) }), _jsx(View, { style: styles.ranges, children: TIME_RANGES.map((r) => {
                    const on = r === range;
                    return (_jsx(Pressable, { onPress: () => setRange(r), style: [styles.rangeChip, on && styles.rangeChipOn], children: _jsx(Text, { style: [styles.rangeChipText, on && styles.rangeChipTextOn], children: r }) }, r));
                }) })] }));
}
function makeStyles(t) {
    return StyleSheet.create({
        wrap: { gap: 14, paddingBottom: 24 },
        empty: { textAlign: 'center', marginTop: 24, fontSize: 14, color: t.subtext },
        tiles: { flexDirection: 'row', gap: 8 },
        tile: { flex: 1, borderRadius: 12, padding: 12, gap: 2, backgroundColor: t.panel, borderWidth: 1, borderColor: t.border },
        tileValue: { fontSize: 18, fontWeight: '800', color: t.text },
        tileLabel: { fontSize: 11, color: t.subtext },
        topCard: { borderRadius: 12, padding: 12, gap: 1, backgroundColor: t.panel, borderWidth: 1, borderColor: t.border },
        topLabel: { fontSize: 11, fontWeight: '600', color: t.subtext },
        topName: { fontSize: 15, fontWeight: '700', color: t.text },
        topVal: { fontSize: 16, fontWeight: '800', color: t.accent },
        sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
        sectionTitle: { fontSize: 15, fontWeight: '700', color: t.text },
        kRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
        kChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
        kChipOn: { backgroundColor: t.selected },
        kChipText: { fontSize: 12, fontWeight: '700', color: t.subtext },
        kChipTextOn: { color: t.text },
        bars: { gap: 6 },
        barRow: { gap: 2 },
        barName: { fontSize: 12, fontWeight: '500', color: t.text },
        barTrack: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        barFill: { height: 14, borderRadius: 3, minWidth: 3 },
        barVal: { fontSize: 11, fontWeight: '600', color: t.subtext },
        legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
        legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
        swatch: { width: 10, height: 10, borderRadius: 2 },
        legendText: { fontSize: 11, color: t.subtext },
        chartWrap: { gap: 8 },
        chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
        chartTitle: { fontSize: 15, fontWeight: '700', color: t.text },
        chartCur: { fontSize: 16, fontWeight: '800', color: t.text },
        chartState: { alignItems: 'center', justifyContent: 'center', gap: 8 },
        chartHint: { fontSize: 12, color: t.subtext },
        ranges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
        rangeChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
        rangeChipOn: { backgroundColor: t.selected },
        rangeChipText: { fontSize: 12, fontWeight: '700', color: t.subtext },
        rangeChipTextOn: { color: t.text },
    });
}
