/**
 * RecentProducts — a "recently released & upcoming" feed for the card catalog, modeled
 * on the product walls collectors browse on card-shop sites.
 *
 * Our catalog is cards + sets (no sealed-product records), so a "product" is a SET,
 * previewed by a montage of its chase cards. Three clickable, infinite carousels:
 *   1. Sets  — released in the last `monthsBack` months + all upcoming (future-dated),
 *              shown `setsPerView` (4) at a time.
 *   2. Upcoming cards    — not yet released, soonest first.
 *   3. Recently released — newest released cards.
 * Each carousel loops (the arrows wrap around) and shows a fixed number at a time.
 *
 * Tapping a card image opens the shared `CardActionModal` — the same sheet the browser
 * uses — offering "Find similar", "View set", and "View on TCGPlayer". Find similar /
 * View set are emitted as `onFindSimilar` / `onViewSet` so a host can route them into
 * another browser on the same screen (see `sendBrowseCommand`); TCGPlayer opens the
 * card's product page via its stable id (`productUrl`). Set tiles also keep a direct
 * "TCGPlayer ↗" link to the set's chase card.
 *
 * App-agnostic like the rest of the kit: colors come from an injected `BrowseTheme`.
 */
import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CardActionModal } from './CardActionModal';
import { formatSetDate, type Catalog, type CatalogCard, type CatalogSet } from './catalog';
import { cardThumbUrl, productUrl } from './config';
import { useImageManifest } from './images';
import { formatUsd, usePriceSummary } from './prices';
import { similarAvailable } from './similar';
import { resolveTheme, type BrowseTheme } from './theme';
import type { CardAction } from './actions';

/** Gap between tiles in a carousel (px). */
const TILE_GAP = 10;
/** Set tiles shown at once (the reference wall's cadence). */
const SETS_PER_VIEW = 4;
/** Card carousels pack to roughly this tile width, then show as many as fit. */
const CARD_TARGET_W = 104;

type Styles = ReturnType<typeof makeStyles>;

interface RecentProductsProps {
  catalog: Catalog;
  /**
   * How far back (in months) a released set stays in the feed. Every set from this
   * window plus all upcoming (future-dated) sets are shown, newest first. Default 12.
   */
  monthsBack?: number;
  /** How many chase cards to montage per set tile. Default 3. */
  montageCount?: number;
  /** Max cards per card carousel (upcoming / released). Default 40. */
  cardLimit?: number;
  /** Injected color contract (partial override merged over the light default). */
  theme?: Partial<BrowseTheme>;
  /** Header title. Default "Recent & Upcoming". */
  title?: string;
  /**
   * Show cards similar to the tapped one — surfaced as a "Find similar" modal action.
   * Wire this to another browser on the page (e.g. via `sendBrowseCommand`). Omitted →
   * the action is hidden.
   */
  onFindSimilar?: (card: CatalogCard) => void;
  /**
   * Open the tapped card's set — surfaced as a "View set" modal action. Wire this to
   * another browser on the page. Omitted → the action is hidden.
   */
  onViewSet?: (card: CatalogCard) => void;
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
  monthsBack = 12,
  montageCount = 3,
  cardLimit = 40,
  theme: themeProp,
  title = 'Recent & Upcoming',
  onFindSimilar,
  onViewSet,
}: RecentProductsProps) {
  const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Card thumbs resolve by id via the content-hashed manifest; repaint when it lands.
  useImageManifest();

  const priceSummary = usePriceSummary();
  const priceOf = (id: string) => priceSummary?.[id]?.cur ?? 0;

  // Today (yyyy-mm-dd) for the upcoming/released split, and the release-window cutoff
  // `monthsBack` months earlier. Computed once (setMonth handles year rollover).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.toISOString().slice(0, 10);
  }, [monthsBack]);

  const setTiles = useMemo<SetTile[]>(() => {
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

  const upcomingCards = useMemo(
    () => catalog.upcomingCards(today, cardLimit),
    [catalog, today, cardLimit],
  );
  const releasedCards = useMemo(
    () => catalog.releasedCards(today, cardLimit),
    [catalog, today, cardLimit],
  );

  // Measured width → how many card tiles a card carousel shows at once.
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w);
  };
  const cardsPerView = width > 0 ? Math.max(3, Math.min(9, Math.floor(width / CARD_TARGET_W))) : 4;

  const [actionCard, setActionCard] = useState<CatalogCard | null>(null);

  const open = (url: string) => {
    if (url) Linking.openURL(url).catch(() => {});
  };

  // The modal's actions for a card: drive-the-other-browser intents (when wired) + TCGPlayer.
  const actionsFor = (card: CatalogCard): CardAction[] => {
    const actions: CardAction[] = [];
    if (onFindSimilar && similarAvailable()) {
      actions.push({
        key: 'find-similar',
        label: '≈ Find similar',
        onPress: (c) => {
          setActionCard(null);
          onFindSimilar(c);
        },
      });
    }
    if (onViewSet && card.setId) {
      actions.push({
        key: 'view-set',
        label: 'View set',
        onPress: (c) => {
          setActionCard(null);
          onViewSet(c);
        },
      });
    }
    actions.push({
      key: 'tcgplayer',
      kind: 'primary',
      label: 'View on TCGPlayer ↗',
      onPress: (c) => {
        setActionCard(null);
        open(productUrl(c.id));
      },
    });
    return actions;
  };

  if (setTiles.length === 0 && upcomingCards.length === 0 && releasedCards.length === 0) {
    return null;
  }

  const renderSet = (t: SetTile, tileWidth: number): ReactNode => (
    <View style={styles.tile}>
      <View style={styles.montage}>
        {t.montage.map((card) => (
          <Pressable
            key={card.id}
            style={styles.montageSlot}
            onPress={() => setActionCard(card)}
            accessibilityLabel={`${card.name} actions`}>
            <Image
              source={{ uri: cardThumbUrl(card.id, 245) }}
              style={styles.fillImg}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={card.id}
              transition={100}
            />
          </Pressable>
        ))}
        {t.upcoming ? (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText}>Upcoming</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.tileName} numberOfLines={2}>
        {t.set.name}
      </Text>
      <Text style={styles.tileMeta} numberOfLines={1}>
        {[formatSetDate(t.set.releaseDate), `${t.set.cardCount.toLocaleString()} cards`]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Pressable onPress={() => open(t.chaseUrl)} hitSlop={4} disabled={!t.chaseUrl}>
        <Text style={styles.tileLink}>TCGPlayer ↗</Text>
      </Pressable>
    </View>
  );

  const renderCard = (card: CatalogCard): ReactNode => {
    const value = priceOf(card.id);
    return (
      <Pressable
        style={styles.scard}
        onPress={() => setActionCard(card)}
        accessibilityLabel={`${card.name} actions`}>
        <CardThumb card={card} styles={styles} />
        <Text style={styles.scardName} numberOfLines={1}>
          {card.name}
        </Text>
        {card.setName ? (
          <Text style={styles.scardSet} numberOfLines={1}>
            {card.setName}
          </Text>
        ) : null}
        <Text style={styles.scardMeta} numberOfLines={1}>
          {value > 0 ? formatUsd(value) : formatSetDate(card.releaseDate)}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      {setTiles.length > 0 ? (
        <>
          <Text style={styles.header}>{title}</Text>
          <Carousel
            items={setTiles}
            visible={SETS_PER_VIEW}
            keyOf={(t) => t.set.id}
            renderItem={renderSet}
            styles={styles}
          />
        </>
      ) : null}

      {upcomingCards.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Upcoming cards</Text>
          <Carousel
            items={upcomingCards}
            visible={cardsPerView}
            keyOf={(c) => c.id}
            renderItem={renderCard}
            styles={styles}
          />
        </>
      ) : null}

      {releasedCards.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Recently released</Text>
          <Carousel
            items={releasedCards}
            visible={cardsPerView}
            keyOf={(c) => c.id}
            renderItem={renderCard}
            styles={styles}
          />
        </>
      ) : null}

      {actionCard ? (
        <CardActionModal
          card={actionCard}
          actions={actionsFor(actionCard)}
          value={priceOf(actionCard.id)}
          onClose={() => setActionCard(null)}
          theme={theme}
        />
      ) : null}
    </View>
  );
}

/**
 * A clickable, infinite carousel: shows `visible` items at once, and the arrows step by
 * one with wrap-around (so it loops forever). Arrows hide when everything already fits.
 * Item width is derived from the measured track so tiles fill the row evenly.
 */
function Carousel<T>({
  items,
  visible,
  keyOf,
  renderItem,
  styles,
}: {
  items: T[];
  visible: number;
  keyOf: (item: T) => string;
  renderItem: (item: T, width: number) => ReactNode;
  styles: Styles;
}) {
  const [start, setStart] = useState(0);
  const [trackW, setTrackW] = useState(0);

  const count = Math.min(visible, items.length);
  const canPage = items.length > count;
  const itemW = trackW > 0 ? Math.floor((trackW - TILE_GAP * (count - 1)) / count) : undefined;
  // Wrap-around window: no duplicates within a view because count < items.length when paging.
  const shown = Array.from({ length: count }, (_, i) => items[(start + i) % items.length]);
  // Page by the group size (next/prev whole screen of items), wrapping infinitely.
  const prev = () => setStart((s) => (s - count + items.length) % items.length);
  const next = () => setStart((s) => (s + count) % items.length);
  const atStart = start === 0;

  return (
    <View style={styles.carousel}>
      {canPage ? (
        <>
          <Pressable
            style={[styles.arrow, atStart && styles.arrowDim]}
            onPress={() => setStart(0)}
            disabled={atStart}
            hitSlop={6}
            accessibilityLabel="Back to start">
            <Text style={styles.arrowText}>⟲</Text>
          </Pressable>
          <Pressable style={styles.arrow} onPress={prev} hitSlop={6} accessibilityLabel="Previous group">
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
        </>
      ) : null}
      <View
        style={styles.track}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0 && Math.abs(w - trackW) > 0.5) setTrackW(w);
        }}>
        {itemW != null
          ? shown.map((item) => (
              <View key={keyOf(item)} style={{ width: itemW }}>
                {renderItem(item, itemW)}
              </View>
            ))
          : null}
      </View>
      {canPage ? (
        <Pressable style={styles.arrow} onPress={next} hitSlop={6} accessibilityLabel="Next group">
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A card thumbnail that falls back to a dated placeholder when the image is missing —
 * e.g. upcoming cards not yet mirrored. The failure is tracked per-URL, so a pre-manifest
 * flat-path 404 still retries the hashed URL once the image manifest lands (otherwise a
 * real card would latch onto the placeholder forever).
 */
function CardThumb({ card, styles }: { card: CatalogCard; styles: Styles }) {
  const uri = cardThumbUrl(card.id, 245);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const missing = !uri || failedUri === uri;
  return (
    <View style={styles.scardImg}>
      {missing ? (
        <View style={styles.thumbPlaceholder}>
          <Text style={styles.thumbPlaceholderText} numberOfLines={2}>
            {card.releaseDate ? formatSetDate(card.releaseDate) : 'No image'}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={styles.fillImg}
          contentFit="contain"
          cachePolicy="memory-disk"
          recyclingKey={card.id}
          transition={100}
          onError={() => setFailedUri(uri)}
        />
      )}
    </View>
  );
}

function makeStyles(t: BrowseTheme) {
  return StyleSheet.create({
    root: { gap: 10 },
    header: { fontSize: 18, fontWeight: '800', color: t.text },
    subHeader: { fontSize: 13, fontWeight: '700', color: t.subtext, marginTop: 4 },

    // carousel
    carousel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    track: { flex: 1, flexDirection: 'row', gap: TILE_GAP },
    arrow: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.panel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrowText: { fontSize: 18, lineHeight: 20, fontWeight: '800', color: t.subtext },
    arrowDim: { opacity: 0.35 },

    // shared image fill
    fillImg: { width: '100%', height: '100%' },

    // set tile
    tile: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 12,
      padding: 8,
      gap: 3,
      backgroundColor: t.panel,
    },
    montage: { flexDirection: 'row', gap: 3, marginBottom: 3 },
    montageSlot: {
      flex: 1,
      aspectRatio: 63 / 88,
      backgroundColor: t.imagePlaceholder,
      borderRadius: 4,
      overflow: 'hidden',
    },
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
    tileMeta: { fontSize: 10, color: t.subtext, fontVariant: ['tabular-nums'] },
    tileLink: { fontSize: 11, fontWeight: '700', color: t.link, marginTop: 1 },

    // card tile
    scard: { gap: 2 },
    scardImg: {
      width: '100%',
      aspectRatio: 63 / 88,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: t.imagePlaceholder,
    },
    thumbPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 3 },
    thumbPlaceholderText: {
      fontSize: 9,
      lineHeight: 12,
      fontWeight: '700',
      color: t.faint,
      textAlign: 'center',
    },
    scardName: { fontSize: 10, lineHeight: 12, color: t.text, textAlign: 'center' },
    scardSet: { fontSize: 8, lineHeight: 10, color: t.subtext, textAlign: 'center' },
    scardMeta: { fontSize: 9, lineHeight: 11, fontWeight: '700', color: t.accent, textAlign: 'center' },
  });
}
