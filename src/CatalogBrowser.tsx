/**
 * Taxonomy browse for the 1×1 "Cards" section of the CardPicker.
 *
 * Drives a Series → Set → Card drill-down over the ~28k-card catalog with a single
 * virtualized FlatList as the primary scroller, so we never nest a VirtualizedList inside
 * the picker sheet. The Series and Set levels render as COMPACT TEXT ROWS (michi has no
 * set/series logo assets, so we never draw big blank cover squares — an optional tiny logo
 * shows only when `coverUri` is present). The Card level renders a DENSE grid whose column
 * count is derived from the measured container width, so tiles stay small instead of being
 * stretched to a fixed column count.
 *
 * Search + filtering are built on a DATA-DRIVEN FACET FRAMEWORK (see the `FACETS` block
 * below): a free-text box overrides the drill-down into a flat grid, and a compact,
 * expandable facet bar filters both the card-list and the search results. Filtering is AND
 * across facets and OR within a single facet's selected values. Adding a new attribute
 * facet later (illustrator, Pokémon type, evolution stage, …) is a one-line change — see
 * the EXTENSION SEAM comment on `FACETS`.
 */
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { describeQuery, parseQuery, QUERY_HINT, QUERY_MANUAL, runQuery } from './query';
import { browseState } from './state';
import { CardActionModal } from './CardActionModal';
import {
  formatSetDate,
  seriesDateRange,
  type Catalog,
  type CatalogCard,
  type CatalogSeries,
  type CatalogSet,
} from './catalog';
import { resolveImageUrl } from './config';
import { formatUsd, usePriceSummary } from './prices';
import { findSimilar, similarAvailable } from './similar';

/** Cap flat search results so a broad query can't build an unbounded grid. */
const SEARCH_LIMIT = 200;
/** Dense grid tuning: aim each card tile at ~this width, then pack as many columns as fit. */
const TARGET_TILE_W = 72;
const GRID_GAP = 6;
const CARD_ASPECT = 88 / 63; // height / width of a standard portrait card
/** Fixed extra height under each card thumb: name line + its margin + inter-row gap. */
const CARD_LABEL_H = 14;
const ROW_GAP = 6;
/** Fixed height of a compact series/set text row (must match `textRow` styles for getItemLayout). */
const TEXT_ROW_H = 60;
/** How many of the first cards to warm through the image cache when a view changes. */
const PREFETCH_COUNT = 12;

// ---------------------------------------------------------------------------
// FACET FRAMEWORK
// ---------------------------------------------------------------------------

/**
 * A data-driven filter descriptor. Each facet knows how to read its value(s) off a card
 * and how to enumerate the distinct values present in a set of cards. Multi-valued facets
 * (e.g. cardType) return several values per card; single-valued ones return `[]` when the
 * field is absent, so a facet with no data simply never renders a chip row.
 */
interface Facet {
  /** Stable key used for selection state. */
  key: string;
  /** Human label for the chip row header. */
  label: string;
  /** The values this card has for the facet ([] when the field is absent/empty). */
  valuesOf: (card: CatalogCard) => string[];
  /** Distinct values across `cards`, already ordered for display. */
  available: (cards: CatalogCard[]) => string[];
}

/** Distinct, alphabetically-sorted values pulled off `cards` via `pick`. */
function distinctSorted(cards: CatalogCard[], pick: (c: CatalogCard) => string[]): string[] {
  return [...new Set(cards.flatMap(pick).filter(Boolean))].sort();
}

/**
 * The facets we can populate from today's catalog. Filtering is AND across entries and OR
 * within a single entry's selected values (see `applyFacets`).
 *
 * ┌─────────────────────────── EXTENSION SEAM ───────────────────────────┐
 * │ To add a new attribute facet (e.g. illustrator, Pokémon type, evo     │
 * │ stage) the ONLY changes required are:                                 │
 * │   1. add the field to `CatalogCard` in src/lib/catalog.ts (+ its      │
 * │      normalization from the raw row in the LocalCatalog constructor), │
 * │   2. add ONE descriptor entry to this array, e.g.                     │
 * │        {                                                              │
 * │          key: 'illustrator',                                          │
 * │          label: 'Illustrator',                                        │
 * │          valuesOf: (c) => (c.illustrator ? [c.illustrator] : []),     │
 * │          available: (cards) =>                                        │
 * │            distinctSorted(cards, (c) => c.illustrator ? [c.illustrator] : []), │
 * │        }                                                              │
 * │ No UI, filtering, or list code changes — a facet with no data yields  │
 * │ `[]` from `available` and is skipped automatically. Multi-value       │
 * │ facets (e.g. a card belonging to several types) just return several   │
 * │ values from `valuesOf` and `distinctSorted` handles the flattening.   │
 * └───────────────────────────────────────────────────────────────────────┘
 */
const FACETS: Facet[] = [
  {
    key: 'rarity',
    label: 'Rarity',
    valuesOf: (c) => (c.rarity ? [c.rarity] : []),
    available: (cards) => distinctSorted(cards, (c) => (c.rarity ? [c.rarity] : [])),
  },
  {
    key: 'cardType',
    label: 'Type',
    valuesOf: (c) => c.cardType ?? [],
    available: (cards) => distinctSorted(cards, (c) => c.cardType ?? []),
  },
  {
    key: 'year',
    label: 'Year',
    valuesOf: (c) => (c.releaseDate ? [c.releaseDate.slice(0, 4)] : []),
    // Newest years first.
    available: (cards) =>
      distinctSorted(cards, (c) => (c.releaseDate ? [c.releaseDate.slice(0, 4)] : [])).reverse(),
  },
  {
    key: 'series',
    label: 'Series',
    valuesOf: (c) => (c.seriesId ? [c.seriesId] : []),
    available: (cards) => distinctSorted(cards, (c) => (c.seriesId ? [c.seriesId] : [])),
  },
  {
    key: 'set',
    label: 'Set',
    valuesOf: (c) => (c.setName ? [c.setName] : []),
    available: (cards) => distinctSorted(cards, (c) => (c.setName ? [c.setName] : [])),
  },
];

/** Selection state: facet key → the values OR-ed together for that facet. */
type FacetSelection = Record<string, string[]>;

/** Apply the current selection: AND across facets, OR within one facet's values. */
function applyFacets(cards: CatalogCard[], selection: FacetSelection): CatalogCard[] {
  const active = FACETS.filter((f) => (selection[f.key]?.length ?? 0) > 0);
  if (active.length === 0) return cards;
  return cards.filter((card) =>
    active.every((f) => {
      const chosen = selection[f.key];
      return f.valuesOf(card).some((v) => chosen.includes(v));
    }),
  );
}

// ---------------------------------------------------------------------------

type BrowseItem =
  | { kind: 'series'; series: CatalogSeries }
  | { kind: 'set'; set: CatalogSet }
  | { kind: 'card'; card: CatalogCard };

interface CatalogBrowserProps {
  catalog: Catalog;
  /** The card currently placed in the pocket (for the selected highlight), if any. */
  selectedCardId?: string;
  onPickCard: (cardId: string) => void;
  /** Artwork-panel + tonal-insert sections, rendered as the list footer so they stay
   *  reachable below the browse without a second scroller. */
  footer: ReactNode;
}

/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export function CatalogBrowser({ catalog, selectedCardId, onPickCard, footer }: CatalogBrowserProps) {
  // Hydrate from the session browse state so reopening the picker restores the
  // last search/drill-down/similar view (one search often feeds several pockets).
  const [cardQuery, setCardQuery] = useState(browseState.cardQuery);
  // Debounce so a keystroke doesn't scan ~28k names synchronously.
  const [cardQueryDebounced, setCardQueryDebounced] = useState(browseState.cardQuery);
  useEffect(() => {
    const handle = setTimeout(() => setCardQueryDebounced(cardQuery), 250);
    return () => clearTimeout(handle);
  }, [cardQuery]);

  const [seriesId, setSeriesId] = useState<string | null>(browseState.seriesId);
  const [setId, setSetId] = useState<string | null>(browseState.setId);
  const [selection, setSelection] = useState<FacetSelection>(browseState.selection);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // "Find similar" mode: results of the data server's embedding RPC for one card.
  const [similarTo, setSimilarTo] = useState<{ id: string; name: string } | null>(
    browseState.similarTo,
  );
  const [similarCards, setSimilarCards] = useState<CatalogCard[]>(browseState.similarCards);

  // Write every change back so the next mount resumes here.
  useEffect(() => {
    Object.assign(browseState, {
      cardQuery,
      seriesId,
      setId,
      selection,
      similarTo,
      similarCards,
    });
  }, [cardQuery, seriesId, setId, selection, similarTo, similarCards]);
  // Tapping a card opens the action sheet (place/replace, find similar, view set)
  // instead of silently replacing the pocket's occupant.
  const [actionCard, setActionCard] = useState<CatalogCard | null>(null);

  // Headline card values (load-once) — powers >$N queries, sort:value, and value labels.
  const priceSummary = usePriceSummary();
  const priceOf = (id: string) => priceSummary?.[id]?.cur ?? 0;

  // Measured content width → dense column count. 0 until the first layout pass.
  const [containerWidth, setContainerWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 0.5) setContainerWidth(w);
  };

  const clearFilters = () => setSelection({});

  const q = cardQueryDebounced.trim();
  const searching = q.length > 0;
  const level: 'search' | 'similar' | 'cards' | 'sets' | 'series' = searching
    ? 'search'
    : similarTo
      ? 'similar'
      : setId
        ? 'cards'
        : seriesId
          ? 'sets'
          : 'series';
  const isCardLevel = level === 'cards' || level === 'search' || level === 'similar';

  const series = useMemo(() => catalog.listSeries(), [catalog]);
  const sets = useMemo(() => (seriesId ? catalog.listSets(seriesId) : []), [catalog, seriesId]);

  // The parsed search-box query (grammar: words, key:value fields, price bounds, sort).
  const parsed = useMemo(() => parseQuery(q), [q]);

  // Cards currently in view, before facet filtering: ranked full-corpus search results
  // (bare words match name/artist/set/series/rarity/type/stage — name hits rank first),
  // similar-mode results, or the set's cards.
  const viewCards = useMemo<CatalogCard[]>(() => {
    if (searching) return runQuery(catalog.listAll(), parsed, priceOf, SEARCH_LIMIT);
    if (similarTo) return similarCards;
    if (setId) return catalog.listCards(setId);
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, searching, parsed, setId, similarTo, similarCards, priceSummary]);

  // Facets that actually have ≥2 distinct values in the cards in view get a chip row.
  const facetOptions = useMemo(
    () =>
      isCardLevel
        ? FACETS.map((f) => ({ facet: f, values: f.available(viewCards) })).filter(
            (o) => o.values.length >= 2,
          )
        : [],
    [isCardLevel, viewCards],
  );

  const filteredCards = useMemo(() => applyFacets(viewCards, selection), [viewCards, selection]);
  const activeFilterCount = useMemo(
    () => Object.values(selection).reduce((n, vals) => n + vals.length, 0),
    [selection],
  );

  // Dense grid geometry from the measured width. Falls back to a sane default pre-layout.
  const { numColumns, tileW } = useMemo(() => {
    if (containerWidth <= 0) return { numColumns: 4, tileW: TARGET_TILE_W };
    const cols = Math.max(3, Math.floor((containerWidth + GRID_GAP) / (TARGET_TILE_W + GRID_GAP)));
    const w = Math.floor((containerWidth - GRID_GAP * (cols - 1)) / cols);
    return { numColumns: cols, tileW: w };
  }, [containerWidth]);

  const cols = isCardLevel ? numColumns : 1;
  const cardRowHeight = Math.round(tileW * CARD_ASPECT + CARD_LABEL_H + ROW_GAP);
  const rowHeight = isCardLevel ? cardRowHeight : TEXT_ROW_H;

  const data = useMemo<BrowseItem[]>(() => {
    if (level === 'series') return series.map((s) => ({ kind: 'series' as const, series: s }));
    if (level === 'sets') return sets.map((s) => ({ kind: 'set' as const, set: s }));
    return filteredCards.map((c) => ({ kind: 'card' as const, card: c }));
  }, [level, series, sets, filteredCards]);

  // Warm the first row of card images through the cache once per distinct view (set/filter/
  // search change), off the render path. Guarded so it fires at most once per view key.
  const prefetchedKey = useRef<string | null>(null);
  const viewKey = `${level}:${setId ?? ''}:${q}:${JSON.stringify(selection)}`;
  useEffect(() => {
    if (!isCardLevel) return;
    if (prefetchedKey.current === viewKey) return;
    prefetchedKey.current = viewKey;
    const uris = filteredCards
      .slice(0, PREFETCH_COUNT)
      .map((c) => resolveImageUrl(c.imageSmall ?? c.image))
      .filter(Boolean);
    if (uris.length > 0) Image.prefetch(uris, 'memory-disk').catch(() => {});
  }, [isCardLevel, viewKey, filteredCards]);

  // Navigation handlers clear facet selection so a stale filter can't hide the next
  // level's cards (avoids a set-state-in-effect on every level change).
  const clearSimilar = () => {
    setSimilarTo(null);
    setSimilarCards([]);
  };
  const openSeries = (id: string) => {
    clearFilters();
    clearSimilar();
    setSeriesId(id);
    setSetId(null);
  };
  const openSet = (id: string) => {
    clearFilters();
    clearSimilar();
    setSetId(id);
  };
  const goSeriesRoot = () => {
    clearFilters();
    clearSimilar();
    setSeriesId(null);
    setSetId(null);
  };
  const goSets = () => {
    clearFilters();
    clearSimilar();
    setSetId(null);
  };
  const onChangeQuery = (text: string) => {
    // Only reset facets when entering/leaving search (empty ↔ non-empty), not on every
    // keystroke — so you can type a query, apply facet chips, then refine the text.
    if (cardQuery.trim().length === 0 !== (text.trim().length === 0)) clearFilters();
    if (text.trim().length > 0) clearSimilar(); // typing a query leaves similar mode
    setCardQuery(text);
  };

  /** "Find similar" — embedding search on the data server, results shown in the grid. */
  const openSimilar = (card: CatalogCard) => {
    setCardQuery('');
    setCardQueryDebounced('');
    clearFilters();
    setSimilarTo({ id: card.id, name: card.name });
    setSimilarCards([]);
    findSimilar(card.id, 24).then((hits) => {
      const cards = hits
        .map((h) => catalog.getCard(h.id))
        .filter((c): c is CatalogCard => Boolean(c));
      setSimilarCards(cards);
    });
  };

  const toggleFacetValue = (key: string, value: string) =>
    setSelection((prev) => {
      const current = prev[key] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [key]: next };
    });

  const currentSeries = seriesId ? catalog.getSeries(seriesId) : undefined;
  const currentSet = setId ? catalog.getSet(setId) : undefined;
  // The card already in the pocket that opened this picker (if any) — offered as
  // a one-tap "find similar to what's here" jump.
  const occupant = selectedCardId ? catalog.getCard(selectedCardId) : undefined;

  const crumbs: Crumb[] = [{ label: 'Series', onPress: seriesId ? goSeriesRoot : undefined }];
  if (currentSeries) {
    crumbs.push({ label: currentSeries.name, onPress: setId ? goSets : undefined });
  }
  if (currentSet) crumbs.push({ label: currentSet.name });

  const keyFor = (item: BrowseItem) =>
    item.kind === 'series'
      ? `ser-${item.series.id}`
      : item.kind === 'set'
        ? `set-${item.set.id}`
        : `card-${item.card.id}`;

  const renderItem = ({ item }: { item: BrowseItem }) => {
    if (item.kind === 'series') {
      const s = item.series;
      const meta = [seriesDateRange(s), `${s.cardCount.toLocaleString()} cards`, `${s.setIds.length} sets`]
        .filter(Boolean)
        .join(' · ');
      return <TextRow title={s.name} meta={meta} coverUri={s.coverUri} onPress={() => openSeries(s.id)} />;
    }
    if (item.kind === 'set') {
      const s = item.set;
      const meta = [s.code, `${s.cardCount.toLocaleString()} cards`, formatSetDate(s.releaseDate)]
        .filter(Boolean)
        .join(' · ');
      return <TextRow title={s.name} meta={meta} coverUri={s.coverUri} onPress={() => openSet(s.id)} />;
    }
    const c = item.card;
    const value = priceOf(c.id);
    return (
      <CardTile
        card={c}
        width={tileW}
        selected={c.id === selectedCardId}
        onPress={() => setActionCard(c)}
        // value replaces the name line when sorting by value (keeps row geometry fixed)
        label={parsed.sort === 'value' && value > 0 ? formatUsd(value) : c.name}
      />
    );
  };

  // getItemLayout: for the grid, every `cols` items share a row of `rowHeight`; for the
  // single-column text levels each item is one row. Lets the list skip hundreds/thousands
  // of offscreen rows without measuring them.
  const getItemLayout = (_data: ArrayLike<BrowseItem> | null | undefined, index: number) => {
    const row = Math.floor(index / cols);
    return { length: rowHeight, offset: rowHeight * row, index };
  };

  return (
    <View style={styles.browser} onLayout={onLayout}>
      <View style={styles.controls}>
        <Text style={styles.sectionLabel}>Cards · 1×1</Text>
        <View style={styles.searchRow}>
          <TextInput
            value={cardQuery}
            onChangeText={onChangeQuery}
            placeholder={`Search ${catalog.cardCount.toLocaleString()} cards — ${QUERY_HINT}`}
            placeholderTextColor="#aaa"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.search, styles.searchFlex]}
          />
          <Pressable
            onPress={() => setHelpOpen((v) => !v)}
            style={[styles.helpBtn, helpOpen && styles.helpBtnOn]}
            hitSlop={6}
            accessibilityLabel="Search syntax help">
            <Text style={[styles.helpBtnText, helpOpen && styles.helpBtnTextOn]}>?</Text>
          </Pressable>
        </View>
        {helpOpen ? <SearchManual onClose={() => setHelpOpen(false)} /> : null}
        {occupant && similarAvailable() && similarTo?.id !== occupant.id ? (
          <Pressable style={styles.pocketSimilar} onPress={() => openSimilar(occupant)}>
            <Text style={styles.pocketSimilarText} numberOfLines={1}>
              ≈ Find similar to “{occupant.name}” (in this pocket)
            </Text>
          </Pressable>
        ) : null}
        {searching ? (
          <View style={styles.metaRow}>
            {/* Echo the PARSED query, not the raw text — the user sees exactly how
                their input was interpreted and can tweak it precisely. */}
            <Text style={styles.meta} numberOfLines={1}>
              {filteredCards.length === viewCards.length
                ? `${viewCards.length} result${viewCards.length === 1 ? '' : 's'}`
                : `${filteredCards.length} of ${viewCards.length}`}
              {viewCards.length >= SEARCH_LIMIT ? '+' : ''} · {describeQuery(parsed, viewCards)}
            </Text>
            <Pressable onPress={() => onChangeQuery('')} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          </View>
        ) : similarTo ? (
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>
              {similarCards.length > 0
                ? `${filteredCards.length} cards similar to “${similarTo.name}”`
                : `Finding cards similar to “${similarTo.name}”…`}
            </Text>
            <Pressable onPress={clearSimilar} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          </View>
        ) : seriesId ? (
          <Breadcrumb crumbs={crumbs} />
        ) : (
          <Text style={styles.meta}>{series.length} series</Text>
        )}
        {isCardLevel && facetOptions.length > 0 ? (
          <FacetBar
            options={facetOptions}
            selection={selection}
            activeCount={activeFilterCount}
            open={filtersOpen}
            onToggleOpen={() => setFiltersOpen((v) => !v)}
            onToggleValue={toggleFacetValue}
            onClear={clearFilters}
          />
        ) : null}
      </View>

      <FlatList
        // Remount when the level or column count changes so numColumns/getItemLayout stay
        // consistent (FlatList can't change numColumns in place).
        key={`lvl-${level}-c${cols}`}
        style={styles.list}
        data={data}
        keyExtractor={keyFor}
        renderItem={renderItem}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? styles.column : undefined}
        contentContainerStyle={styles.listContent}
        getItemLayout={getItemLayout}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={cols * 6}
        maxToRenderPerBatch={cols * 4}
        windowSize={9}
        removeClippedSubviews
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searching
              ? `No cards match “${q}”.`
              : level === 'similar'
                ? similarCards.length === 0 && similarTo
                  ? 'Searching…'
                  : 'No similar cards found.'
                : level === 'cards'
                  ? 'No cards in this set.'
                  : 'Nothing here.'}
          </Text>
        }
        ListFooterComponent={<View style={styles.footer}>{footer}</View>}
      />

      {actionCard ? (
        <CardActionModal
          card={actionCard}
          occupant={occupant}
          value={priceOf(actionCard.id)}
          onPlace={() => {
            setActionCard(null);
            onPickCard(actionCard.id);
          }}
          onSimilar={
            similarAvailable()
              ? () => {
                  setActionCard(null);
                  openSimilar(actionCard);
                }
              : undefined
          }
          onViewSet={
            actionCard.setId
              ? () => {
                  setActionCard(null);
                  setCardQuery('');
                  setCardQueryDebounced('');
                  clearSimilar();
                  clearFilters();
                  setSeriesId(actionCard.seriesId || null);
                  setSetId(actionCard.setId);
                }
              : undefined
          }
          onClose={() => setActionCard(null)}
        />
      ) : null}
    </View>
  );
}

// ---- compact taxonomy rows + card tile + breadcrumb ----------------------------

/**
 * A compact text row for a series or set: title + meta line, an optional tiny logo only
 * when one exists (michi has none for most), and a chevron. No big blank cover squares.
 */
function TextRow({
  title,
  meta,
  coverUri,
  onPress,
}: {
  title: string;
  meta: string;
  coverUri?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.textRow} onPress={onPress}>
      {coverUri ? (
        <Image source={{ uri: coverUri }} style={styles.textRowLogo} contentFit="contain" transition={100} />
      ) : null}
      <View style={styles.textRowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

/**
 * A single dense catalog-card tile. Width is driven by the measured grid so tiles stay
 * small. Cards with no local image show a neutral fallback, never a crash. Images use the
 * same memory-disk cache + recyclingKey pattern as BinderGrid.
 */
function CardTile({
  card,
  width,
  selected,
  onPress,
  label,
}: {
  card: CatalogCard;
  width: number;
  selected: boolean;
  onPress: () => void;
  /** Text under the thumb; defaults to the card name (value when sorting by value). */
  label?: string;
}) {
  // Grid tier: the 245px webp (~20KB) when the card has one; full-size fallback.
  const uri = resolveImageUrl(card.imageSmall ?? card.image);
  return (
    <Pressable style={[styles.cardTile, { width }, selected && styles.cardTileSelected]} onPress={onPress}>
      <View style={styles.cardImageWrap}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.cardImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={card.id}
            transition={100}
          />
        ) : (
          <View style={styles.cardImageFallback}>
            <Text style={styles.cardImageFallbackText}>no image</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {label ?? card.name}
      </Text>
    </Pressable>
  );
}

/** The "?" panel: the search grammar manual (content lives in browse/query.ts,
 *  shared with the sibling app; this just renders it compactly). */
function SearchManual({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.manual}>
      <View style={styles.manualHeader}>
        <Text style={styles.manualTitle}>Search syntax</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.clear}>Close</Text>
        </Pressable>
      </View>
      {QUERY_MANUAL.map((section) => (
        <View key={section.title} style={styles.manualSection}>
          <Text style={styles.manualSectionTitle}>{section.title}</Text>
          {section.rows.map(([code, description]) => (
            <View key={code} style={styles.manualRow}>
              <Text style={styles.manualCode}>{code}</Text>
              <Text style={styles.manualDesc}>{description}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

interface Crumb {
  label: string;
  onPress?: () => void; // omitted for the current (last) crumb
}

/** Series › Set path; tap an ancestor to drill up. */
function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <View style={styles.bcBar}>
      {crumbs.map((c, i) => (
        <View key={`${c.label}-${i}`} style={styles.bcItem}>
          {i > 0 ? <Text style={styles.bcSep}>›</Text> : null}
          <Text
            onPress={c.onPress}
            style={[styles.bcCrumb, c.onPress ? styles.bcLink : styles.bcCurrent]}
            numberOfLines={1}>
            {c.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

interface FacetOption {
  facet: Facet;
  values: string[];
}

/**
 * Compact, expandable filter panel. Collapsed it's a single row (a Filters toggle + active
 * count + Clear); expanded it reveals one horizontal multi-select chip row per populated
 * facet — so it never eats the card viewport.
 */
function FacetBar({
  options,
  selection,
  activeCount,
  open,
  onToggleOpen,
  onToggleValue,
  onClear,
}: {
  options: FacetOption[];
  selection: FacetSelection;
  activeCount: number;
  open: boolean;
  onToggleOpen: () => void;
  onToggleValue: (key: string, value: string) => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.facetBar}>
      <View style={styles.facetHeader}>
        <Pressable onPress={onToggleOpen} style={[styles.facetToggle, activeCount > 0 && styles.facetToggleOn]}>
          <Text style={[styles.facetToggleText, activeCount > 0 && styles.facetToggleTextOn]}>
            {open ? '▾ Filters' : '▸ Filters'}
            {activeCount > 0 ? ` · ${activeCount}` : ''}
          </Text>
        </Pressable>
        {activeCount > 0 ? (
          <Pressable onPress={onClear} hitSlop={8}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View style={styles.facetRows}>
          {options.map(({ facet, values }) => (
            <View key={facet.key} style={styles.facetGroup}>
              <Text style={styles.facetLabel}>{facet.label}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                keyboardShouldPersistTaps="handled">
                {values.map((v) => {
                  const on = (selection[facet.key] ?? []).includes(v);
                  return (
                    <Pressable
                      key={v}
                      onPress={() => onToggleValue(facet.key, v)}
                      style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                        {v}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  browser: { flex: 1 },
  // The list must claim the remaining sheet height (sibling of the fixed-height controls)
  // so it gets a bounded, scrollable viewport instead of growing to full content height.
  list: { flex: 1 },
  controls: { gap: 6, paddingBottom: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  search: {
    borderWidth: 1,
    borderColor: '#e0e0e3',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    color: '#222',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  searchFlex: { flex: 1 },
  pocketSimilar: {
    borderWidth: 1,
    borderColor: '#3B82F655',
    backgroundColor: '#3B82F60F',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pocketSimilarText: { fontSize: 12, fontWeight: '600', color: '#2a5db0' },
  helpBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#e0e0e3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpBtnOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  helpBtnText: { fontSize: 14, fontWeight: '700', color: '#888' },
  helpBtnTextOn: { color: '#fff' },
  // search manual panel
  manual: {
    borderWidth: 1,
    borderColor: '#e8e8ec',
    borderRadius: 10,
    padding: 10,
    gap: 8,
    backgroundColor: '#fafafc',
  },
  manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  manualTitle: { fontSize: 13, fontWeight: '700', color: '#444' },
  manualSection: { gap: 3 },
  manualSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  manualRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  manualCode: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#2a5db0',
    minWidth: 118,
  },
  manualDesc: { flex: 1, fontSize: 12, color: '#666', lineHeight: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  meta: { fontSize: 12, color: '#999', flexShrink: 1 },
  clear: { fontSize: 13, fontWeight: '600', color: '#3B82F6' },
  // facet bar
  facetBar: { gap: 6 },
  facetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  facetToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.35)',
  },
  facetToggleOn: { borderColor: '#3B82F6' },
  facetToggleText: { fontSize: 12, fontWeight: '600', color: '#666' },
  facetToggleTextOn: { color: '#3B82F6' },
  facetRows: { gap: 4 },
  facetGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  facetLabel: { fontSize: 11, fontWeight: '600', color: '#999', width: 58 },
  chipRow: { gap: 6, paddingRight: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.35)',
    maxWidth: 180,
  },
  chipOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#666' },
  chipTextOn: { color: '#fff' },
  // list
  column: { gap: GRID_GAP, justifyContent: 'flex-start' },
  listContent: { paddingBottom: 16 },
  empty: { textAlign: 'center', color: '#999', marginTop: 24, fontSize: 13 },
  footer: { paddingTop: 4 },
  // compact series/set text rows
  textRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: TEXT_ROW_H,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ececed',
  },
  textRowLogo: { width: 40, height: 40, borderRadius: 6, backgroundColor: '#f4f4f6' },
  textRowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#2a2a30' },
  rowMeta: { fontSize: 11, color: '#8a8a93' },
  rowChevron: { fontSize: 20, color: '#c4c4c8', paddingHorizontal: 2 },
  // dense card tiles
  cardTile: { marginBottom: ROW_GAP },
  cardTileSelected: { backgroundColor: '#e8f0fe', borderRadius: 6 },
  cardImageWrap: {
    width: '100%',
    aspectRatio: 63 / 88,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#f0f0f3',
  },
  cardImage: { width: '100%', height: '100%' },
  cardImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardImageFallbackText: { color: '#b0b0b8', fontSize: 8 },
  cardName: { fontSize: 9, lineHeight: 12, marginTop: 2, color: '#555', textAlign: 'center' },
  // breadcrumb
  bcBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  bcItem: { flexDirection: 'row', alignItems: 'center' },
  bcSep: { fontSize: 13, color: '#bbb', marginHorizontal: 6 },
  bcCrumb: { fontSize: 13 },
  bcLink: { color: '#3B82F6', fontWeight: '600' },
  bcCurrent: { color: '#666' },
});
