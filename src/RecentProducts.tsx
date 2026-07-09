/**
 * RecentProducts — a "recently released" feed for the card catalog, modeled on the
 * product walls collectors browse on card-shop sites.
 *
 * Our catalog is cards + sets (no sealed-product records), so the faithful analog is
 * recently-released SETS, each tile a montage of that set's chase cards (its priciest
 * few) — which is exactly how those product tiles read. Below the sets grid, a "New
 * cards" strip surfaces the very newest individual cards.
 *
 * Everything links straight to TCGPlayer via the card's stable id (`productUrl` — a
 * pure `{id}` template). A set has no single tcgid, so its tile opens its chase card's
 * product page. Future-dated sets sort first (see `catalog.allSets()`) and get an
 * "Upcoming" badge, so previews of not-yet-released products lead the feed for free.
 *
 * App-agnostic like the rest of the kit: colors come from an injected `BrowseTheme`,
 * navigation is an external link (no router import), and the feed is self-contained —
 * drop `<RecentProducts catalog={catalog} />` onto any screen.
 */
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  Linking,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatSetDate, type Catalog, type CatalogCard, type CatalogSet } from './catalog';
import { cardThumbUrl, productUrl } from './config';
import { useImageManifest } from './images';
import { formatUsd, usePriceSummary } from './prices';
import { resolveTheme, type BrowseTheme } from './theme';

/** Target set-tile width (px); the grid packs as many columns as fit, min 2. */
const TARGET_TILE_W = 156;
const GRID_GAP = 10;
/** New-cards strip thumbnail width (px). */
const STRIP_CARD_W = 66;

interface RecentProductsProps {
  catalog: Catalog;
  /**
   * How far back (in months) a released set stays in the feed. Every set from this
   * window plus all upcoming (future-dated) sets are shown, newest first. Default 3.
   */
  monthsBack?: number;
  /** How many chase cards to montage per set tile. Default 3 (like the reference wall). */
  montageCount?: number;
  /** How many newest cards to show in the strip. Default 20; pass 0 to hide the strip. */
  cardLimit?: number;
  /** Injected color contract (partial override merged over the light default). */
  theme?: Partial<BrowseTheme>;
  /** Optional header title. Default "Recent Sets". */
  title?: string;
}

/** A set paired with its montage cards (priciest first) and its chase card's TCGPlayer URL. */
interface SetTile {
  set: CatalogSet;
  montage: CatalogCard[];
  chaseUrl: string;
  upcoming: boolean;
}

export function RecentProducts({
  catalog,
  monthsBack = 3,
  montageCount = 3,
  cardLimit = 20,
  theme: themeProp,
  title = 'Recent & Upcoming',
}: RecentProductsProps) {
  const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Card thumbs resolve by id via the content-hashed manifest; repaint when it lands.
  useImageManifest();

  // Chase-card selection needs headline values; before prices load, priceOf is 0 for
  // all and the montage falls back to the set's natural (collector-number) order.
  const priceSummary = usePriceSummary();
  const priceOf = (id: string) => priceSummary?.[id]?.cur ?? 0;

  // Today (yyyy-mm-dd) for the upcoming/released split, and the release cutoff
  // `monthsBack` months earlier. Computed once (setMonth handles year rollover).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.toISOString().slice(0, 10);
  }, [monthsBack]);

  const tiles = useMemo<SetTile[]>(() => {
    // Keep sets released within the window OR still upcoming (future dates are
    // >= cutoff by definition, so this one bound covers both). allSets() is
    // already sorted newest/future first.
    return catalog
      .allSets()
      .filter((set) => Boolean(set.releaseDate) && set.releaseDate >= cutoff)
      .map((set) => {
        const cards = catalog.listCards(set.id);
        const montage = [...cards]
          .sort((a, b) => priceOf(b.id) - priceOf(a.id))
          .slice(0, montageCount);
        return {
          set,
          montage,
          chaseUrl: montage[0] ? productUrl(montage[0].id) : '',
          upcoming: set.releaseDate > today,
        };
      })
      .filter((t) => t.montage.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, cutoff, montageCount, priceSummary, today]);

  const newCards = useMemo(
    () => (cardLimit > 0 ? catalog.recentCards(cardLimit) : []),
    [catalog, cardLimit],
  );

  // Measured width → set-tile column count (packs to `TARGET_TILE_W`, min 2).
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w);
  };
  const { cols, tileW } = useMemo(() => {
    if (width <= 0) return { cols: 3, tileW: TARGET_TILE_W };
    const c = Math.max(2, Math.floor((width + GRID_GAP) / (TARGET_TILE_W + GRID_GAP)));
    return { cols: c, tileW: Math.floor((width - GRID_GAP * (c - 1)) / c) };
  }, [width]);

  const open = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  // Nothing in the window (and no cards) → render nothing rather than a bare header.
  if (tiles.length === 0 && newCards.length === 0) return null;

  return (
    <View style={styles.root} onLayout={onLayout}>
      {tiles.length > 0 ? (
        <>
          <Text style={styles.header}>{title}</Text>

          <View style={styles.grid}>
            {tiles.map(({ set, montage, chaseUrl, upcoming }) => (
              <Pressable
                key={set.id}
                style={[styles.tile, { width: tileW }]}
                onPress={() => open(chaseUrl)}
                accessibilityLabel={`${set.name} on TCGPlayer`}>
                <View style={styles.montage}>
                  {montage.map((card) => (
                    <View key={card.id} style={styles.montageSlot}>
                      <Image
                        source={{ uri: cardThumbUrl(card.id, 245) }}
                        style={styles.montageImg}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        recyclingKey={card.id}
                        transition={100}
                      />
                    </View>
                  ))}
                  {upcoming ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>Upcoming</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.tileName} numberOfLines={2}>
                  {set.name}
                </Text>
                <Text style={styles.tileMeta} numberOfLines={1}>
                  {[formatSetDate(set.releaseDate), `${set.cardCount.toLocaleString()} cards`]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={styles.tileLink} numberOfLines={1}>
                  TCGPlayer ↗
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {newCards.length > 0 ? (
        <>
          <Text style={styles.subHeader}>New cards</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}>
            {newCards.map((card) => (
              <Pressable
                key={card.id}
                style={styles.stripCard}
                onPress={() => open(productUrl(card.id))}
                accessibilityLabel={`${card.name} on TCGPlayer`}>
                <View style={styles.stripImgWrap}>
                  <Image
                    source={{ uri: cardThumbUrl(card.id, 245) }}
                    style={styles.montageImg}
                    contentFit="contain"
                    cachePolicy="memory-disk"
                    recyclingKey={card.id}
                    transition={100}
                  />
                </View>
                <Text style={styles.stripName} numberOfLines={1}>
                  {card.name}
                </Text>
                {priceOf(card.id) > 0 ? (
                  <Text style={styles.stripValue} numberOfLines={1}>
                    {formatUsd(priceOf(card.id))}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

function makeStyles(t: BrowseTheme) {
  return StyleSheet.create({
    root: { gap: 10 },
    header: { fontSize: 18, fontWeight: '800', color: t.text },
    subHeader: { fontSize: 13, fontWeight: '700', color: t.subtext, marginTop: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
    tile: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 8,
      gap: 3,
      backgroundColor: t.panel,
    },
    // Montage: chase cards side by side. Each slot carries the portrait aspect ratio,
    // so the row sizes its own height — no fixed height to keep in sync.
    montage: { flexDirection: 'row', gap: 3, marginBottom: 3 },
    montageSlot: {
      flex: 1,
      aspectRatio: 63 / 88,
      backgroundColor: t.imagePlaceholder,
      borderRadius: 4,
      overflow: 'hidden',
    },
    montageImg: { width: '100%', height: '100%' },
    badge: {
      position: 'absolute',
      top: 4,
      left: 4,
      backgroundColor: t.accent,
      borderRadius: 5,
      paddingHorizontal: 5,
      paddingVertical: 2,
    },
    badgeText: { color: t.accentText, fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
    tileName: { fontSize: 12, fontWeight: '700', color: t.text, lineHeight: 15 },
    tileMeta: { fontSize: 10, color: t.subtext },
    tileLink: { fontSize: 11, fontWeight: '700', color: t.link, marginTop: 1 },
    // New-cards strip
    strip: { gap: 8, paddingRight: 8 },
    stripCard: { width: STRIP_CARD_W, gap: 2 },
    stripImgWrap: {
      width: '100%',
      aspectRatio: 63 / 88,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: t.imagePlaceholder,
    },
    stripName: { fontSize: 9, lineHeight: 11, color: t.subtext, textAlign: 'center' },
    stripValue: { fontSize: 9, lineHeight: 11, fontWeight: '700', color: t.accent, textAlign: 'center' },
  });
}
