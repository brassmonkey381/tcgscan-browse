/**
 * The sealed-product catalog, browsable: booster boxes, ETBs, tins, bundles — priced.
 *
 * DELIBERATELY NOT CatalogBrowser, and not a tab inside it. Cards need a series → set → card
 * drill-down, a server search, the query grammar and a warm/cold catalog split because there are
 * hundreds of thousands of them. Sealed is ~3k products that arrive as ONE public JSON (see
 * sealed.ts) with no catalog dependency and no cold path, so a flat client-filtered grid is the
 * honest shape — and bending the card browser around a second catalog shape would buy nothing.
 *
 * IT LOOKS LIKE THE CARD GRID ON PURPOSE, because it sits one segment away from it. Every visual
 * token here is copied from CatalogBrowser rather than invented: chrome-free tiles whose art
 * carries the rounding, a quiet `subtext` name, the price in `accent` (the only coloured thing on
 * a tile), the quick-add as an accent pill overlaying the thumb, accent-filled selected chips, and
 * the same S/M/L steps from cardSize.ts. The first draft of this file borrowed the kit's BIG-tile
 * language (panel + border + shadow, loud name, quiet price) from the series/set tiles, which
 * inverted the emphasis: on a card tile the price is what your eye is meant to land on.
 *
 * THE HOST DECIDES WHO SEES IT, by importing it or not. That is the kit's existing way of having
 * a surface one app shows and the other does not — RecentProducts is michi's and tcgscan-app
 * mounts it nowhere; this is the mirror image. No flag, no lock, no platform sniff: a
 * BrowseFeature would be wrong by construction (that union is the TIER seam, and a locked feature
 * is meant to stay VISIBLE and advertise a plan), and a runtime app check is forbidden outright.
 *
 * Search stays a substring over name + series rather than the kit's query grammar. The grammar
 * assumes a card — half its vocabulary (artist:, rarity:, hp>N, sort:stage) would match zero
 * sealed rows without saying so, and its name-word heuristic suppresses set matches for exactly
 * the words a sealed product is named after. Adopting it means an adapter, a sealed manual and an
 * unsupported-field notice: a separate piece of work, not a promotion.
 */
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import { LanguageToggle } from './LanguageToggle';
import { CARD_GRID_GAP, CARD_SIZE_FRACTION, CARD_SIZES, cardTileWidthFor } from './cardSize';
import type { CardLanguage } from './catalog';
import { useBrowseLanguages } from './language';
import { formatUsd } from './prices';
import { releaseTag } from './releaseTag';
import { SEALED_GROUPS, sealedGroupOf, type SealedGroup } from './sealed-groups';
import { sealedLanguageOf, useSealed, type SealedProduct } from './sealed';
import type { CardSize } from './state';
import { resolveTheme, type BrowseTheme } from './theme';

/**
 * Columns at the S step. M and L fall out of the kit's own size fractions ({S:1, M:0.72, L:0.45},
 * cardSize.ts), so the sealed steps land on 8 / 6 / 4 and stay tied to the card grid's notion of
 * what S, M and L mean — change the fractions there and both grids move together.
 *
 * A TARGET, not a packing: unlike cardGridColumns, which derives a base from the container width,
 * these are fixed so the step means the same thing on a phone and on a desktop. Sealed art is
 * square-ish product photography that survives being small, and the S step is meant to be dense.
 */
const SEALED_BASE_COLUMNS = 8;

export function SealedBrowser({
  theme: themeProp,
  languages,
  numColumns,
  onOpen,
  onAdd,
  addLabel = '＋',
}: {
  theme?: Partial<BrowseTheme>;
  /**
   * PIN this surface to specific printings. Omit to follow the shared browse preference, which is
   * what makes the sealed shelf agree with the card shelf beside it; when pinned, the toggle is
   * hidden because the host has already decided.
   */
  languages?: CardLanguage[];
  /** Pin the column count. Omit for the S/M/L steps; passing it hides the size toggle. */
  numColumns?: number;
  /** Open a product. Omitted → tiles are not pressable. */
  onOpen?: (product: SealedProduct) => void;
  /** The corner quick-add. Omitted → no pill, the same way every app-shaped affordance here works. */
  onAdd?: (product: SealedProduct) => void;
  /** Glyph for that pill, if a host wants words instead. */
  addLabel?: string;
}) {
  const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { sealed, priceOf, status } = useSealed();
  const [shared] = useBrowseLanguages();
  const langs = languages ?? shared;
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<SealedGroup | 'all'>('all');
  const [size, setSize] = useState<CardSize>('M');
  const [containerWidth, setContainerWidth] = useState(0);

  // 0.5px hysteresis, copied from the card grid: without it a fractional relayout re-renders
  // forever, each pass reporting a width a hair different from the last.
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 0.5) setContainerWidth(w);
  };

  const cols = numColumns ?? Math.max(1, Math.round(SEALED_BASE_COLUMNS * CARD_SIZE_FRACTION[size]));
  const tileW = containerWidth > 0 ? cardTileWidthFor(containerWidth, cols, CARD_GRID_GAP) : 0;

  const wanted = useMemo(
    () => new Set(langs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity churns; the contents do not
    [langs.join(',')],
  );

  const shown = useMemo(() => {
    if (!sealed) return [];
    const q = query.trim().toLowerCase();
    return sealed
      .newestFirst()
      .filter((p) => wanted.has(sealedLanguageOf(p)))
      .filter((p) => group === 'all' || sealedGroupOf(p.name) === group)
      .filter((p) => !q || `${p.name} ${p.series}`.toLowerCase().includes(q));
  }, [sealed, query, group, wanted]);

  const searching = query.trim().length > 0;
  const emptyText =
    status === 'loading'
      ? 'Loading sealed products…'
      : status === 'error'
        ? 'Sealed products aren’t available right now.'
        : searching
          ? `Nothing matches “${query.trim()}”.`
          : 'No sealed products here.';

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <View style={styles.controls}>
        <Text style={styles.sectionLabel}>Sealed</Text>
        {/* Input and the EN/JP pills share a row, as they do above the card grid. */}
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search sealed products…"
            placeholderTextColor={theme.faint}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            style={[styles.search, styles.searchFlex]}
          />
          {languages ? null : <LanguageToggle theme={themeProp} />}
        </View>
        {/* WHAT KIND OF THING, then how big to draw it — one row, the card shelf's facet shape. */}
        <View style={styles.facetGroup}>
          <Text style={styles.facetLabel}>Type</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}>
            {[{ key: 'all' as const, label: 'Everything' }, ...SEALED_GROUPS].map((g) => {
              const on = group === g.key;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => setGroup(g.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                    {g.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {numColumns ? null : (
            <View style={styles.sizeChips}>
              {CARD_SIZES.map((s) => {
                const on = s === size;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setSize(s)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Tile size ${s}`}
                    style={[styles.sizeChip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        numColumns={cols}
        key={cols} /* FlatList cannot change its column count in place */
        columnWrapperStyle={cols > 1 ? styles.column : undefined}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        }
        renderItem={({ item: p }) => {
          const price = formatUsd(priceOf(p.id));
          return (
            <Pressable
              style={[styles.tile, tileW > 0 ? { width: tileW } : null]}
              accessibilityRole={onOpen ? 'button' : undefined}
              accessibilityLabel={p.name}
              disabled={!onOpen}
              onPress={onOpen ? () => onOpen(p) : undefined}>
              <View style={styles.imageWrap}>
                {/* Sealed rows carry their own tiered URLs — no manifest, no tier march. The 640px
                    webp is asked for once a tile is big enough to show it, as the card grid does. */}
                <Image
                  source={{ uri: (tileW >= 150 ? p.imageMedium : p.imageSmall) || p.image }}
                  style={styles.image}
                  contentFit="contain"
                  transition={100}
                  recyclingKey={p.id}
                />
                {onAdd ? (
                  <Pressable
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${p.name}`}
                    onPress={() => onAdd(p)}
                    style={styles.quick}>
                    <Text style={styles.quickText}>{addLabel}</Text>
                  </Pressable>
                ) : null}
                {/* Sealed carries a release date and never showed it, so a box shipping next week
                    and one from two years ago looked identical on the shelf. Same ladder as the
                    Recent & Upcoming tiles. */}
                {(() => {
                  const tag = releaseTag(p.releaseDate);
                  if (!tag) return null;
                  return (
                    <View
                      style={[styles.badge, tag.kind === 'countdown' && styles.badgeCountdown]}
                      pointerEvents="none">
                      <Text style={styles.badgeText} numberOfLines={1}>
                        {tag.label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {p.name}
              </Text>
              {price ? <Text style={styles.price}>{price}</Text> : null}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function makeStyles(t: BrowseTheme) {
  return StyleSheet.create({
    wrap: { flex: 1 },
    controls: { gap: 6, paddingBottom: 8 },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: t.subtext,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 4,
    },
    search: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 14,
      color: t.text,
    },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    searchFlex: { flex: 1 },
    facetGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    facetLabel: { fontSize: 11, fontWeight: '600', color: t.subtext, width: 58 },
    chipRow: { gap: 6, paddingRight: 8 },
    chip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      maxWidth: 180,
    },
    chipOn: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { fontSize: 12, fontWeight: '600', color: t.subtext },
    chipTextOn: { color: t.accentText },
    sizeChips: { flexDirection: 'row', gap: 4, marginLeft: 8 },
    sizeChip: {
      minWidth: 26,
      alignItems: 'center',
      paddingHorizontal: 7,
      paddingVertical: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
    },
    // The grid. No tile chrome: the art carries the rounding, exactly as on the card shelf — and
    // at the S step a border plus padding would eat half of a ~40px tile.
    column: { gap: CARD_GRID_GAP, justifyContent: 'flex-start' },
    listContent: { paddingBottom: 16 },
    tile: { marginBottom: CARD_GRID_GAP },
    imageWrap: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: t.imagePlaceholder,
    },
    image: { width: '100%', height: '100%' },
    quick: {
      position: 'absolute',
      top: 3,
      right: 3,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickText: { color: t.accentText, fontSize: 11, fontWeight: '800', lineHeight: 14 },
    // Bottom-left, so it never collides with the add button top-right.
    badge: {
      position: 'absolute',
      left: 3,
      bottom: 3,
      maxWidth: '92%',
      borderRadius: 5,
      paddingHorizontal: 4,
      paddingVertical: 1,
      backgroundColor: t.accent,
    },
    badgeCountdown: { backgroundColor: t.danger },
    badgeText: { color: t.accentText, fontSize: 8, fontWeight: '800', letterSpacing: 0.2 },
    name: { fontSize: 9, lineHeight: 12, marginTop: 2, color: t.subtext, textAlign: 'center' },
    // The one coloured thing on a tile, as on the card shelf — this is what the eye lands on.
    price: { fontSize: 9, lineHeight: 12, fontWeight: '700', color: t.accent, textAlign: 'center' },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyText: { color: t.subtext, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  });
}
