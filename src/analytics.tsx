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
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

import type { Catalog, CatalogCard } from './catalog';
import {
  getCardPrices,
  orderedVariants,
  rangeCutoff,
  TIME_RANGES,
  TimeRange,
  usePriceSummary,
} from './prices';
import { lightTheme, RARITY_PALETTE, type BrowseTheme } from './theme';

type Styles = ReturnType<typeof makeStyles>;

const TOP_K = [10, 20, 30, 50, 0] as const; // 0 = All

function money(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

interface Priced {
  card: CatalogCard;
  value: number;
}

/** All priced cards in a set of cards, sorted priciest-first, using the summary map. */
function pricedCards(cards: CatalogCard[], summary: Record<string, { cur: number }> | null): Priced[] {
  if (!summary) return [];
  return cards
    .map((card) => ({ card, value: summary[card.id]?.cur }))
    .filter((p): p is Priced => p.value != null)
    .sort((a, b) => b.value - a.value);
}

/** Set-level value analytics. `onOpenCard` navigates (app-supplied). */
export function SetAnalytics({
  catalog,
  setId,
  onOpenCard,
  theme = lightTheme,
}: {
  catalog: Catalog;
  setId: string;
  onOpenCard: (cardId: string) => void;
  theme?: BrowseTheme;
}) {
  const summary = usePriceSummary();
  const priced = useMemo(() => pricedCards(catalog.listCards(setId), summary), [catalog, summary, setId]);
  return <ValueAnalytics priced={priced} ready={!!summary} onOpenCard={onOpenCard} theme={theme} />;
}

/** Series-level value analytics — the same view over every card in the series. */
export function SeriesAnalytics({
  catalog,
  seriesId,
  onOpenCard,
  theme = lightTheme,
}: {
  catalog: Catalog;
  seriesId: string;
  onOpenCard: (cardId: string) => void;
  theme?: BrowseTheme;
}) {
  const summary = usePriceSummary();
  const cards = useMemo(
    () => catalog.listSets(seriesId).flatMap((s) => catalog.listCards(s.id)),
    [catalog, seriesId],
  );
  const priced = useMemo(() => pricedCards(cards, summary), [cards, summary]);
  return <ValueAnalytics priced={priced} ready={!!summary} onOpenCard={onOpenCard} theme={theme} />;
}

/** The shared value view (tiles, top-K bars, legend, value-over-time). */
function ValueAnalytics({
  priced,
  ready,
  onOpenCard,
  theme,
}: {
  priced: Priced[];
  ready: boolean;
  onOpenCard: (cardId: string) => void;
  theme: BrowseTheme;
}) {
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const rarityColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of priced) {
      const r = p.card.rarity || 'Unknown';
      if (!map.has(r)) map.set(r, RARITY_PALETTE[map.size % RARITY_PALETTE.length]);
    }
    return map;
  }, [priced]);

  const [k, setK] = useState<number>(20);

  if (!ready) return <ActivityIndicator style={{ marginTop: 24 }} />;
  if (!priced.length) return <Text style={styles.empty}>No price data here yet.</Text>;

  const total = priced.reduce((s, p) => s + p.value, 0);
  const top = priced[0];
  const avg = total / priced.length;
  const shown = k === 0 ? priced : priced.slice(0, k);
  const maxVal = top.value;

  return (
    <View style={styles.wrap}>
      <View style={styles.tiles}>
        <Tile styles={styles} label="Total value" value={money(total)} />
        <Tile styles={styles} label="Priced cards" value={`${priced.length}`} />
        <Tile styles={styles} label="Avg card" value={money(avg)} />
      </View>

      <Pressable style={styles.topCard} onPress={() => onOpenCard(top.card.id)}>
        <Text style={styles.topLabel}>Most valuable</Text>
        <Text style={styles.topName} numberOfLines={1}>{top.card.name}</Text>
        <Text style={styles.topVal}>{money(top.value)}</Text>
      </Pressable>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Top cards by value</Text>
        <View style={styles.kRow}>
          {TOP_K.map((opt) => {
            const on = opt === k;
            return (
              <Pressable key={opt} onPress={() => setK(opt)} style={[styles.kChip, on && styles.kChipOn]}>
                <Text style={[styles.kChipText, on && styles.kChipTextOn]}>{opt === 0 ? 'All' : opt}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.bars}>
        {shown.map((p, i) => (
          <Pressable key={p.card.id} style={styles.barRow} onPress={() => onOpenCard(p.card.id)}>
            <Text style={styles.barName} numberOfLines={1}>{i + 1}. {p.card.name}</Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.max(2, (p.value / maxVal) * 100)}%`, backgroundColor: rarityColor.get(p.card.rarity || 'Unknown') },
                ]}
              />
              <Text style={styles.barVal}>{money(p.value)}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      <View style={styles.legend}>
        {[...rarityColor.entries()].map(([r, c]) => (
          <View key={r} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: c }]} />
            <Text style={styles.legendText}>{r}</Text>
          </View>
        ))}
      </View>

      <AggregateValueOverTime priced={priced} theme={theme} />
    </View>
  );
}

function Tile({ styles, label, value }: { styles: Styles; label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

// --- aggregate value over time (lazy) ----------------------------------------

/**
 * Cap the value-over-time aggregate to the top-N priciest cards. Summing EVERY
 * priced card fans out one price-history request per card — hundreds for a big set,
 * thousands for a series (e.g. ~7.8k for "Promos & Miscellaneous") — which queues
 * behind the ~6-connection limit and hammers the price API. The line is dominated
 * by the top cards, so the top-N sum is visually near-identical for a fraction of
 * the requests. When capped, the chart title says so rather than posing as the full
 * total (which the "Total value" tile still reports over all priced cards).
 */
const AGG_TOP_N = 100;

/** Sum the priciest variant of the top-N priced cards by date → one value-over-time series. */
function AggregateValueOverTime({ priced, theme }: { priced: Priced[]; theme: BrowseTheme }) {
  const [series, setSeries] = useState<ValuePoint[] | null>(null);
  const capped = priced.length > AGG_TOP_N;
  const shown = Math.min(priced.length, AGG_TOP_N);

  useEffect(() => {
    let on = true;
    setSeries(null);
    // priced is sorted priciest-first, so the first AGG_TOP_N are the top by value.
    const source = capped ? priced.slice(0, AGG_TOP_N) : priced;
    Promise.all(source.map((p) => getCardPrices(p.card.id))).then((all) => {
      if (!on) return;
      const byDate = new Map<string, number>();
      for (const p of all) {
        if (!p) continue;
        const v = orderedVariants(p)[0];
        for (const pt of p.variants[v] ?? []) {
          if (pt.m != null) byDate.set(pt.d, (byDate.get(pt.d) ?? 0) + pt.m);
        }
      }
      setSeries([...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, v })));
    });
    return () => {
      on = false;
    };
  }, [priced, capped]);

  return (
    <ValueOverTimeChart
      title={capped ? `Value over time · top ${AGG_TOP_N}` : 'Value over time'}
      series={series}
      loadingLabel={`aggregating ${shown} cards…`}
      theme={theme}
    />
  );
}

// --- per-card price history ---------------------------------------------------

/**
 * One card's price history: a variant toggle (priciest variant first) over the shared
 * value-over-time chart. Cards open here in the action sheet; this is the detail chart.
 */
export function PriceChart({ cardId, theme = lightTheme }: { cardId: string; theme?: BrowseTheme }) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [prices, setPrices] = useState<Awaited<ReturnType<typeof getCardPrices>> | null | undefined>(undefined);
  const [variant, setVariant] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    setPrices(undefined);
    setVariant(null);
    getCardPrices(cardId).then((p) => {
      if (!on) return;
      setPrices(p);
      setVariant(p ? orderedVariants(p)[0] ?? null : null);
    });
    return () => {
      on = false;
    };
  }, [cardId]);

  const variants = prices ? orderedVariants(prices) : [];
  const points = prices && variant ? prices.variants[variant] ?? [] : [];
  const series = useMemo<ValuePoint[] | null>(() => {
    if (prices === undefined) return null; // loading
    return points.filter((p) => p.m != null).map((p) => ({ d: p.d, v: p.m as number }));
  }, [prices, points]);

  if (prices === null) return <Text style={styles.empty}>No price history for this card.</Text>;

  return (
    <View style={styles.wrap}>
      {variants.length > 1 ? (
        <View style={styles.kRow}>
          {variants.map((v) => {
            const on = v === variant;
            return (
              <Pressable key={v} onPress={() => setVariant(v)} style={[styles.kChip, on && styles.kChipOn]}>
                <Text style={[styles.kChipText, on && styles.kChipTextOn]}>{v}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <ValueOverTimeChart title={variant ?? 'Price'} series={series} theme={theme} />
    </View>
  );
}

// --- shared value-over-time line chart ---------------------------------------

export interface ValuePoint {
  d: string; // yyyy-mm-dd
  v: number;
}

const H = 180;
const PAD = { top: 10, right: 12, bottom: 20, left: 48 };

/** Presentational value-over-time line chart. `series` null = still loading. */
export function ValueOverTimeChart({
  title,
  series,
  loadingLabel,
  theme = lightTheme,
}: {
  title: string;
  series: ValuePoint[] | null;
  loadingLabel?: string;
  theme?: BrowseTheme;
}) {
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [range, setRange] = useState<TimeRange>('1Y');
  const [width, setWidth] = useState(0);

  const windowed = useMemo(() => {
    if (!series) return [];
    const cutoff = rangeCutoff(range);
    return cutoff ? series.filter((p) => p.d >= cutoff) : series;
  }, [series, range]);

  const chart = useMemo(() => {
    if (!width || windowed.length < 2) return null;
    const innerW = width - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const vals = windowed.map((p) => p.v);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) max += 1;
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
    const n = windowed.length;
    const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * innerH;
    let d = '';
    windowed.forEach((p, i) => (d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`));
    const area = `${d}L${x(n - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)}L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)}Z`;
    return { d, area, ticks: [max - pad, (min + max) / 2, min + pad], y };
  }, [width, windowed]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const current = windowed.length ? windowed[windowed.length - 1].v : null;

  return (
    <View style={styles.chartWrap}>
      <View style={styles.chartHead}>
        <Text style={styles.chartTitle}>{title}</Text>
        {current != null ? <Text style={styles.chartCur}>{money(current)}</Text> : null}
      </View>

      <View onLayout={onLayout} style={{ width: '100%' }}>
        {series == null ? (
          <View style={[styles.chartState, { height: H }]}>
            <ActivityIndicator />
            {loadingLabel ? <Text style={styles.chartHint}>{loadingLabel}</Text> : null}
          </View>
        ) : chart ? (
          <Svg width={width} height={H}>
            <Defs>
              <LinearGradient id="votfill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={theme.accent} stopOpacity={0.22} />
                <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {chart.ticks.map((t, i) => (
              <SvgText key={i} x={PAD.left - 6} y={chart.y(t) + 3} fontSize={9} fill={theme.subtext} textAnchor="end">
                {money(t)}
              </SvgText>
            ))}
            <Path d={chart.area} fill="url(#votfill)" />
            <Path d={chart.d} stroke={theme.accent} strokeWidth={2} fill="none" strokeLinejoin="round" />
          </Svg>
        ) : (
          <View style={[styles.chartState, { height: H }]}>
            <Text style={styles.chartHint}>Not enough data for this range</Text>
          </View>
        )}
      </View>

      <View style={styles.ranges}>
        {TIME_RANGES.map((r) => {
          const on = r === range;
          return (
            <Pressable key={r} onPress={() => setRange(r)} style={[styles.rangeChip, on && styles.rangeChipOn]}>
              <Text style={[styles.rangeChipText, on && styles.rangeChipTextOn]}>{r}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(t: BrowseTheme) {
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
