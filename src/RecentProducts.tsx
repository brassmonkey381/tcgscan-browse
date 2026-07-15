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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CardActionModal } from './CardActionModal';
import { formatSetDate, type Catalog, type CatalogCard } from './catalog';
import { cardThumbUrl, productUrl, setShopUrl } from './config';
import { useImageManifest } from './images';
import { usePriceSummary } from './prices';
import { fetchRecentWindow, fetchSetMeta, serverSearchAvailable, type SetMeta } from './search';
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

/** The set identity a feed tile carries — same fields warm (catalog) and cold (REST). */
export interface FeedSet {
  id: string;
  name: string;
  seriesId: string;
  releaseDate: string;
  cardCount: number;
  /** Official set logo, '' when unknown. */
  coverUri: string;
}

interface RecentProductsProps {
  /** The loaded catalog, or null to run catalog-FREE (the feed fetches its own slim data
   *  from the public cards/sets tables — same three carousels either way). */
  catalog: Catalog | null;
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
  /**
   * Open a whole SET (from a set tile tap) — wire this to another browser on the page
   * (e.g. via `sendBrowseCommand({type:'viewSetById'})`). Omitted → set tiles aren't tappable
   * at the tile level (their montage cards still open the card action modal).
   */
  onOpenSet?: (set: FeedSet) => void;
  /**
   * Drop the tapped card into a binder — surfaced as the PRIMARY "Add to a binder…" action
   * (a host chooser then picks the target binder). When wired, TCGPlayer demotes to a
   * secondary action. Omitted → the action is hidden (TCGPlayer stays primary).
   */
  onAddToBinder?: (card: CatalogCard) => void;
}

/** A set paired with its montage cards (priciest first) and its TCGPlayer set-category URL. */
interface SetTile {
  set: FeedSet;
  montage: CatalogCard[];
  shopUrl: string;
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
  onOpenSet,
  onAddToBinder,
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

  // Catalog-FREE data: without the catalog, fetch the same window from the public tables
  // (recent+upcoming cards, set names/counts/logos). Load-once per mount; fails soft.
  const [cold, setCold] = useState<{ cards: CatalogCard[]; meta: Map<string, SetMeta> } | null>(
    null,
  );
  useEffect(() => {
    if (catalog || cold || !serverSearchAvailable()) return;
    let live = true;
    Promise.all([fetchRecentWindow(cutoff), fetchSetMeta()]).then(([cards, meta]) => {
      if (live) setCold({ cards, meta });
    });
    return () => {
      live = false;
    };
  }, [catalog, cold, cutoff]);

  const setTiles = useMemo<SetTile[]>(() => {
    // The set's TCGPlayer category page. TCGPlayer's slug is derivable from the set name with
    // one rule — `&` becomes "and" (verified against the sets table); setShopUrl handles the
    // rest (lowercase, non-alphanumeric → dashes).
    const shopFor = (name: string) => setShopUrl(name.replace(/&/g, ' and '));
    const tile = (set: FeedSet, cards: CatalogCard[]): SetTile => ({
      set,
      montage: [...cards].sort((a, b) => priceOf(b.id) - priceOf(a.id)).slice(0, montageCount),
      shopUrl: shopFor(set.name),
      upcoming: set.releaseDate > today,
    });
    if (catalog) {
      return catalog
        .allSets()
        .filter((set) => Boolean(set.releaseDate) && set.releaseDate >= cutoff)
        .map((set) =>
          tile(
            {
              id: set.id,
              name: set.name,
              seriesId: set.seriesId,
              releaseDate: set.releaseDate,
              cardCount: set.cardCount,
              coverUri: set.coverUri ?? '',
            },
            catalog.listCards(set.id),
          ),
        )
        .filter((t) => t.montage.length > 0);
    }
    if (!cold) return [];
    // Cold: group the window's cards by set; a set's release = its earliest card date.
    const bySet = new Map<string, CatalogCard[]>();
    for (const c of cold.cards) {
      if (!c.setId) continue;
      const list = bySet.get(c.setId) ?? [];
      list.push(c);
      bySet.set(c.setId, list);
    }
    return [...bySet.entries()]
      .map(([setId, cards]) => {
        const meta = cold.meta.get(setId);
        const releaseDate = cards.reduce(
          (min, c) => (c.releaseDate && c.releaseDate < min ? c.releaseDate : min),
          cards[0]?.releaseDate ?? '',
        );
        return tile(
          {
            id: setId,
            name: meta?.name ?? cards[0]?.setName ?? '',
            seriesId: meta?.series ?? cards[0]?.seriesId ?? '',
            releaseDate,
            cardCount: meta?.cardCount ?? cards.length,
            coverUri: meta?.logoUrl ?? '',
          },
          cards,
        );
      })
      .filter((t) => t.montage.length > 0)
      .sort((a, b) => b.set.releaseDate.localeCompare(a.set.releaseDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, cold, cutoff, montageCount, priceSummary, today]);

  const upcomingCards = useMemo(() => {
    if (catalog) return catalog.upcomingCards(today, cardLimit);
    if (!cold) return [];
    return [...cold.cards]
      .filter((c) => c.releaseDate > today)
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name))
      .slice(0, cardLimit);
  }, [catalog, cold, today, cardLimit]);
  const releasedCards = useMemo(() => {
    if (catalog) return catalog.releasedCards(today, cardLimit);
    if (!cold) return [];
    return [...cold.cards]
      .filter((c) => c.releaseDate && c.releaseDate <= today)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
      .slice(0, cardLimit);
  }, [catalog, cold, today, cardLimit]);

  // One carousel of cards: upcoming + recently-released, shuffled into a single mix. Seeded by
  // the concatenated ids (mulberry32) so it's stable across re-renders but reshuffles when the
  // window changes — no Math.random (unstable + unavailable in some runtimes).
  const mixedCards = useMemo(() => {
    const pool = [...upcomingCards, ...releasedCards];
    let seed = 0;
    for (const c of pool) for (let i = 0; i < c.id.length; i += 1) seed = (seed * 31 + c.id.charCodeAt(i)) >>> 0;
    const rand = (() => {
      let a = seed || 1;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [upcomingCards, releasedCards]);

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

  // The store link shared by set + card tiles. Labeled "Shop" (store-agnostic); points at
  // the card's TCGPlayer product page for now (productUrl). `centered` for the card tiles.
  const shopLink = (url: string, centered = false): ReactNode => (
    <Pressable onPress={() => open(url)} hitSlop={4} disabled={!url} accessibilityLabel="Shop this card">
      <Text style={[styles.tileLink, centered && styles.tileLinkCenter]}>Shop →</Text>
    </Pressable>
  );

  // The modal's actions for a card: add-to-binder (host chooser) + drive-the-other-browser
  // intents (when wired) + TCGPlayer.
  const actionsFor = (card: CatalogCard): CardAction[] => {
    const actions: CardAction[] = [];
    if (onAddToBinder) {
      actions.push({
        key: 'add-to-binder',
        kind: 'primary',
        label: 'Add to a binder…',
        onPress: (c) => {
          setActionCard(null);
          onAddToBinder(c);
        },
      });
    }
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
      // Add-to-binder owns the primary slot when wired; TCGPlayer becomes secondary.
      kind: onAddToBinder ? 'default' : 'primary',
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
    // Tap the tile (its name / meta / padding) to open the whole set in the host browser; the
    // montage cards are their own Pressables on top, so tapping a card still opens its modal.
    <Pressable
      style={styles.tile}
      onPress={onOpenSet ? () => onOpenSet(t.set) : undefined}
      accessibilityRole={onOpenSet ? 'button' : undefined}
      accessibilityLabel={onOpenSet ? `Browse ${t.set.name}${t.upcoming ? ' (upcoming)' : ''}` : undefined}>
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
      <View style={styles.tileFooter}>
        <View style={styles.tileFooterLeft}>
          <Text style={styles.tileName} numberOfLines={2}>
            {t.set.name}
          </Text>
          <Text style={styles.tileMeta} numberOfLines={1}>
            {[formatSetDate(t.set.releaseDate), `${t.set.cardCount.toLocaleString()} cards`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {shopLink(t.shopUrl)}
        </View>
        {t.set.coverUri ? (
          // The set's official logo fills the footer's free corner.
          <Image
            source={{ uri: t.set.coverUri }}
            style={styles.tileLogo}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={`logo-${t.set.id}`}
            transition={100}
          />
        ) : null}
      </View>
    </Pressable>
  );

  const renderCard = (card: CatalogCard): ReactNode => (
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
      {shopLink(productUrl(card.id), true)}
    </Pressable>
  );

  return (
    <View style={styles.root} onLayout={onLayout}>
      {title ? <Text style={styles.header}>{title}</Text> : null}

      {setTiles.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Sets</Text>
          <Carousel
            items={setTiles}
            visible={SETS_PER_VIEW}
            keyOf={(t) => t.set.id}
            renderItem={renderSet}
            styles={styles}
          />
        </>
      ) : null}

      {mixedCards.length > 0 ? (
        <>
          <Text style={styles.subHeader}>Cards</Text>
          <Carousel
            items={mixedCards}
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
  const [page, setPage] = useState(0);
  const [trackW, setTrackW] = useState(0);

  // Discrete pages of `visible` items each (last page may be partial). Paging wraps
  // infinitely; the indicator below reports position, so pages don't drift off-boundary.
  const pageSize = visible;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const canPage = pages > 1;
  const safePage = Math.min(page, pages - 1);
  // Tiles-per-row for the width math: a full page while paging, else however many exist
  // (so a single short page fills the row instead of leaving a big gap).
  const perRow = canPage ? pageSize : items.length;
  const itemW = trackW > 0 ? Math.floor((trackW - TILE_GAP * (perRow - 1)) / perRow) : undefined;
  const shown = canPage ? items.slice(safePage * pageSize, safePage * pageSize + pageSize) : items;

  const prev = () => setPage((p) => (Math.min(p, pages - 1) - 1 + pages) % pages);
  const next = () => setPage((p) => (Math.min(p, pages - 1) + 1) % pages);
  const atStart = safePage === 0;

  return (
    <View style={styles.carouselWrap}>
      <View style={styles.carousel}>
        {canPage ? (
          <>
            <Pressable
              style={[styles.arrow, atStart && styles.arrowDim]}
              onPress={() => setPage(0)}
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
      {canPage ? (
        <PageIndicator pages={pages} current={safePage} onJump={setPage} styles={styles} />
      ) : null}
    </View>
  );
}

/**
 * Page indicator under a carousel: tappable dots when there are few pages, or a compact
 * "n / total" readout when there are too many dots to scan.
 */
function PageIndicator({
  pages,
  current,
  onJump,
  styles,
}: {
  pages: number;
  current: number;
  onJump: (page: number) => void;
  styles: Styles;
}) {
  if (pages > 12) {
    return (
      <Text style={styles.pageText}>
        {current + 1} / {pages}
      </Text>
    );
  }
  return (
    <View style={styles.dots}>
      {Array.from({ length: pages }, (_, i) => (
        <Pressable key={i} onPress={() => onJump(i)} hitSlop={6} accessibilityLabel={`Page ${i + 1}`}>
          <View style={[styles.dot, i === current && styles.dotOn]} />
        </Pressable>
      ))}
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** yyyy-mm-dd -> "Sep 12, 2026" — the full date (incl. day) for the imageless-card placeholder. */
function formatFullDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const mon = MONTHS[parseInt(m, 10) - 1] ?? '';
  return d ? `${mon} ${parseInt(d, 10)}, ${y}` : `${mon} ${y}`.trim();
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
            {card.releaseDate ? formatFullDate(card.releaseDate) : 'No image'}
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
    carouselWrap: { gap: 6 },
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
    // page indicator
    dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.border },
    dotOn: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.accent },
    pageText: {
      textAlign: 'center',
      fontSize: 11,
      fontWeight: '700',
      color: t.subtext,
      fontVariant: ['tabular-nums'],
    },

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
    tileFooter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tileFooterLeft: { flex: 1, gap: 3 },
    tileLogo: { width: 72, height: 44 },
    tileName: { fontSize: 12, fontWeight: '700', color: t.text, lineHeight: 15 },
    tileMeta: { fontSize: 10, color: t.subtext, fontVariant: ['tabular-nums'] },
    tileLink: { fontSize: 11, fontWeight: '700', color: t.link, marginTop: 1 },
    tileLinkCenter: { textAlign: 'center' },

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
