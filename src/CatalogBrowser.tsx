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
 *
 * App-agnostic by construction: colors come from an injected `BrowseTheme` (default
 * light), navigation is via callbacks (`onOpenCard`/`onPickCard`, no router import), and
 * the card action sheet is filled in by the app via `cardActions` (see actions.ts).
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
import { browseState, subscribeBrowseCommand } from './state';
import { CardActionModal } from './CardActionModal';
import { SeriesAnalytics, SetAnalytics } from './analytics';
import {
  resolveActions,
  type BrowserBuiltins,
  type CardAction,
  type CardActionsFactory,
} from './actions';
import {
  formatSetDate,
  seriesDateRange,
  type Catalog,
  type CatalogCard,
  type CatalogSeries,
  type CatalogSet,
} from './catalog';
import { cardThumbUrl } from './config';
import { useImageManifest } from './images';
import { formatUsd, usePriceSummary } from './prices';
import { findSimilar, similarAvailable } from './similar';
import { resolveTheme, type BrowseTheme } from './theme';

/** Cap flat search results so a broad query can't build an unbounded grid. */
const SEARCH_LIMIT = 200;
/** Dense grid tuning: aim each card tile at ~this width, then pack as many columns as fit. */
const TARGET_TILE_W = 72;
const GRID_GAP = 6;
const CARD_ASPECT = 88 / 63; // height / width of a standard portrait card
/** Fixed extra height under each card thumb: name line + its margin + inter-row gap. */
const CARD_LABEL_H = 14;
const ROW_GAP = 6;
/** Series/set tiles: target width (packs into 3–5 columns by page width) + a fixed tile height
 *  (must match the `taxTile` style so getItemLayout can skip offscreen rows). */
const TARGET_TAX_TILE_W = 210;
const TAX_TILE_H = 136;
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

type Styles = ReturnType<typeof makeStyles>;

interface CatalogBrowserProps {
  catalog: Catalog;
  /** The card currently placed in the pocket (for the selected highlight), if any. */
  selectedCardId?: string;
  /**
   * Legacy/default primary action. When supplied and `cardActions` is omitted, the sheet
   * shows a "Place in pocket" / Replace "<occupant>" primary that calls this — preserving
   * poke-michi's binder behavior. Apps with a richer action set pass `cardActions` instead.
   */
  onPickCard?: (cardId: string) => void;
  /**
   * App-supplied per-card action list for the tap sheet. Receives the browser's
   * `BrowserBuiltins` (findSimilar / viewSet / viewIllustrator, each present only when
   * applicable) so the app composes
   * `[...appActions, builtins.findSimilar, builtins.viewSet, builtins.viewIllustrator]`.
   * When omitted, the sheet falls back to the `onPickCard` default above.
   */
  cardActions?: CardActionsFactory;
  /**
   * Optional inline quick action rendered as a compact corner pill on each card tile
   * (e.g. tcgscan-app's "＋" add, michi's quick-place). Return `undefined` to omit it for a
   * card. Its `label` should be short (a glyph or 1–2 chars) — it's tiny. Tapping it fires
   * the action WITHOUT opening the sheet. Reuses the shared `CardAction` model.
   */
  quickAction?: (card: CatalogCard) => CardAction | undefined;
  /** Where analytics tiles/bars navigate on tap. Defaults to `onPickCard`. */
  onOpenCard?: (cardId: string) => void;
  /** Artwork-panel + tonal-insert sections, rendered as the list footer so they stay
   *  reachable below the browse without a second scroller. */
  footer: ReactNode;
  /** Surface value analytics: a Cards | Analytics toggle in a set (SetAnalytics)
   *  plus a headline value under each card tile. Off by default — apps that don't
   *  want pricing (e.g. michi's binder picker) simply omit it. */
  analytics?: boolean;
  /** Injected color contract (partial override merged over the light default). */
  theme?: Partial<BrowseTheme>;
  /**
   * Target width (px) for each card thumbnail — the grid packs as many columns as fit, then
   * divides the measured width evenly, so a larger value yields fewer, bigger cards. Defaults
   * to the dense browse default; consumers wanting binder-sized cards pass e.g. ~140.
   */
  cardTileWidth?: number;
  /** Height (px) of each series/set art tile. Larger = taller cover art. Defaults to the
   *  standard tile height. */
  taxTileHeight?: number;
}

/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export function CatalogBrowser({
  catalog,
  selectedCardId,
  onPickCard,
  cardActions,
  quickAction,
  onOpenCard,
  footer,
  analytics,
  theme: themeProp,
  cardTileWidth = TARGET_TILE_W,
  taxTileHeight = TAX_TILE_H,
}: CatalogBrowserProps) {
  const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
  const styles = useMemo(() => makeStyles(theme, taxTileHeight), [theme, taxTileHeight]);
  // Hydrate the content-hashed image manifest and repaint tiles when it lands —
  // card images resolve by id (cardThumbUrl), not from URLs in the catalog.
  useImageManifest();

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
  // Tapping a card opens the action sheet (app-supplied actions + built-ins)
  // instead of silently replacing the pocket's occupant.
  const [actionCard, setActionCard] = useState<CatalogCard | null>(null);
  // Cards | Analytics toggle within a set OR a series (only when `analytics` is enabled).
  // Resets to the card/set grid whenever the drilled-into series or set changes.
  const [analyticsTab, setAnalyticsTab] = useState<'cards' | 'analytics'>('cards');
  useEffect(() => {
    setAnalyticsTab('cards');
  }, [seriesId, setId]);

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
  const { numColumns, tileW, taxCols, taxTileW } = useMemo(() => {
    if (containerWidth <= 0) {
      return { numColumns: 4, tileW: cardTileWidth, taxCols: 3, taxTileW: TARGET_TAX_TILE_W };
    }
    const cCols = Math.max(3, Math.floor((containerWidth + GRID_GAP) / (cardTileWidth + GRID_GAP)));
    const cW = Math.floor((containerWidth - GRID_GAP * (cCols - 1)) / cCols);
    // Series/set tiles: 3–5 columns depending on page width (a bigger target than card tiles).
    const tCols = Math.max(3, Math.min(5, Math.floor((containerWidth + GRID_GAP) / (TARGET_TAX_TILE_W + GRID_GAP))));
    const tW = Math.floor((containerWidth - GRID_GAP * (tCols - 1)) / tCols);
    return { numColumns: cCols, tileW: cW, taxCols: tCols, taxTileW: tW };
  }, [containerWidth, cardTileWidth]);

  const cols = isCardLevel ? numColumns : taxCols;
  const cardRowHeight = Math.round(tileW * CARD_ASPECT + CARD_LABEL_H + ROW_GAP);
  const rowHeight = isCardLevel ? cardRowHeight : taxTileHeight + ROW_GAP;

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
      .map((c) => cardThumbUrl(c.id, 245))
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

  /** Jump the drill-down to a card's set (clearing search/similar/filters first). */
  const jumpToSet = (card: CatalogCard) => {
    setCardQuery('');
    setCardQueryDebounced('');
    clearSimilar();
    clearFilters();
    setSeriesId(card.seriesId || null);
    setSetId(card.setId ?? null);
  };

  // Let another surface on the screen (e.g. the RecentProducts feed) drive this browser:
  // "find similar to X" / "view X's set" run the same handlers as the in-sheet builtins.
  useEffect(() => {
    return subscribeBrowseCommand((cmd) => {
      const card = catalog.getCard(cmd.cardId);
      if (!card) return;
      if (cmd.type === 'similar') openSimilar(card);
      else if (cmd.type === 'viewSet') jumpToSet(card);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  /** Show every card by this card's illustrator — a search on the `artist:` field
   *  (quoted, since illustrator names have spaces). Sets both the raw and debounced
   *  query so results appear immediately, like jumpToSet/openSimilar. */
  const viewIllustrator = (card: CatalogCard) => {
    const q = `artist:"${card.illustrator}"`;
    clearSimilar();
    clearFilters();
    setCardQuery(q);
    setCardQueryDebounced(q);
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
  const openCard = onOpenCard ?? onPickCard ?? (() => {});

  /** The package-intrinsic actions for a card, bound to this browser's state. */
  const builtinsFor = (card: CatalogCard): BrowserBuiltins => ({
    findSimilar: similarAvailable()
      ? {
          key: 'find-similar',
          label: '≈ Find similar',
          onPress: (c) => {
            setActionCard(null);
            openSimilar(c);
          },
        }
      : undefined,
    viewSet: card.setId
      ? {
          key: 'view-set',
          label: 'View set',
          onPress: (c) => {
            setActionCard(null);
            jumpToSet(c);
          },
        }
      : undefined,
    viewIllustrator: card.illustrator
      ? {
          key: 'view-illustrator',
          label: (c) => `View ${c.illustrator}`,
          onPress: (c) => {
            setActionCard(null);
            viewIllustrator(c);
          },
        }
      : undefined,
  });

  /** Resolve the sheet's actions for the tapped card: app-supplied, or the michi default. */
  const actionsFor = (card: CatalogCard): CardAction[] => {
    const builtins = builtinsFor(card);
    if (cardActions) return resolveActions(cardActions(card, builtins), card);
    // Back-compat default: poke-michi's place/replace primary + the built-ins.
    const placeDefault: CardAction[] = onPickCard
      ? [
          {
            key: 'place',
            kind: 'primary',
            label: (c) =>
              occupant && occupant.id !== c.id ? `Replace “${occupant.name}”` : 'Place in pocket',
            onPress: (c) => {
              setActionCard(null);
              onPickCard(c.id);
            },
          },
        ]
      : [];
    const list = [
      ...placeDefault,
      builtins.findSimilar,
      builtins.viewSet,
      builtins.viewIllustrator,
    ].filter((a): a is CardAction => Boolean(a));
    return resolveActions(list, card);
  };

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
      return (
        <TaxonomyTile styles={styles} title={s.name} meta={meta} coverUri={s.coverUri} width={taxTileW} onPress={() => openSeries(s.id)} />
      );
    }
    if (item.kind === 'set') {
      const s = item.set;
      const meta = [s.code, `${s.cardCount.toLocaleString()} cards`, formatSetDate(s.releaseDate)]
        .filter(Boolean)
        .join(' · ');
      return (
        <TaxonomyTile styles={styles} title={s.name} meta={meta} coverUri={s.coverUri} width={taxTileW} onPress={() => openSet(s.id)} />
      );
    }
    const c = item.card;
    const value = priceOf(c.id);
    return (
      <CardTile
        styles={styles}
        card={c}
        width={tileW}
        selected={c.id === selectedCardId}
        onPress={() => setActionCard(c)}
        // value replaces the name line when sorting by value (keeps row geometry fixed)
        label={parsed.sort === 'value' && value > 0 ? formatUsd(value) : c.name}
        // headline value under the name, only when pricing is surfaced
        value={analytics ? value : undefined}
        // app-injected inline quick action (＋add / quick-place), if any
        quickAction={quickAction?.(c)}
      />
    );
  };

  // Analytics is offered at the set level (over the set's cards) and the series level
  // (over every card in the series). `analyticsScope` is the target of the current toggle,
  // or null when analytics isn't applicable here.
  const analyticsScope: 'set' | 'series' | null =
    !analytics ? null : level === 'cards' && setId ? 'set' : level === 'sets' && seriesId ? 'series' : null;
  // Analytics replaces the card/set grid when the toggle is on.
  const analyticsView = analyticsScope != null && analyticsTab === 'analytics';

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
            placeholderTextColor={theme.faint}
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
        {helpOpen ? <SearchManual styles={styles} onClose={() => setHelpOpen(false)} /> : null}
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
          <Breadcrumb styles={styles} crumbs={crumbs} />
        ) : (
          <Text style={styles.meta}>{series.length} series</Text>
        )}
        {analyticsScope ? (
          <View style={styles.tabRow}>
            {(['cards', 'analytics'] as const).map((t) => {
              const on = t === analyticsTab;
              const label = t === 'analytics' ? 'Analytics' : analyticsScope === 'series' ? 'Sets' : 'Cards';
              return (
                <Pressable key={t} onPress={() => setAnalyticsTab(t)} style={[styles.tab, on && styles.tabOn]}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {isCardLevel && facetOptions.length > 0 && !analyticsView ? (
          <FacetBar
            styles={styles}
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

      {analyticsView ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.analyticsContent}>
          {analyticsScope === 'set' && setId ? (
            <SetAnalytics catalog={catalog} setId={setId} onOpenCard={openCard} theme={theme} />
          ) : analyticsScope === 'series' && seriesId ? (
            <SeriesAnalytics catalog={catalog} seriesId={seriesId} onOpenCard={openCard} theme={theme} />
          ) : null}
        </ScrollView>
      ) : (
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
      )}

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

// ---- compact taxonomy rows + card tile + breadcrumb ----------------------------

/**
 * A series/set tile for the multi-column taxonomy grid: a logo (or the initial when michi
 * has no cover, which is most), the name, and a meta line. Fixed height so getItemLayout can
 * skip offscreen rows.
 */
function TaxonomyTile({
  styles,
  title,
  meta,
  coverUri,
  width,
  onPress,
}: {
  styles: Styles;
  title: string;
  meta: string;
  coverUri?: string;
  width: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.taxTile, { width }]} onPress={onPress}>
      <View style={styles.taxLogoWrap}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={styles.taxLogo} contentFit="contain" transition={100} />
        ) : (
          <Text style={styles.taxInitial}>{title.trim().charAt(0).toUpperCase()}</Text>
        )}
      </View>
      <Text style={styles.taxTitle} numberOfLines={2}>
        {title}
      </Text>
      {meta ? (
        <Text style={styles.taxMeta} numberOfLines={2}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * A single dense catalog-card tile. Width is driven by the measured grid so tiles stay
 * small. Cards with no local image show a neutral fallback, never a crash. Images use the
 * same memory-disk cache + recyclingKey pattern as BinderGrid.
 */
function CardTile({
  styles,
  card,
  width,
  selected,
  onPress,
  label,
  value,
  quickAction,
}: {
  styles: Styles;
  card: CatalogCard;
  width: number;
  selected: boolean;
  onPress: () => void;
  /** Text under the thumb; defaults to the card name (value when sorting by value). */
  label?: string;
  /** Headline value shown under the name (when pricing is surfaced); hidden if 0/absent. */
  value?: number;
  /** Inline quick action pill (app-injected); its onPress fires without opening the sheet. */
  quickAction?: CardAction;
}) {
  // Grid tier: the 245px webp (~20KB), resolved by id via the image manifest.
  const uri = cardThumbUrl(card.id, 245);
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
        {quickAction ? (
          // Nested Pressable captures its own tap, so the tile's sheet doesn't open.
          <Pressable
            style={styles.cardQuick}
            hitSlop={6}
            onPress={() => quickAction.onPress(card)}
            accessibilityLabel={typeof quickAction.label === 'string' ? quickAction.label : 'Quick action'}>
            <Text style={styles.cardQuickText} numberOfLines={1}>
              {typeof quickAction.label === 'function' ? quickAction.label(card) : quickAction.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {label ?? card.name}
      </Text>
      {value != null && value > 0 ? (
        <Text style={styles.cardValue} numberOfLines={1}>
          {formatUsd(value)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The "?" panel: the search grammar manual (content lives in browse/query.ts,
 *  shared with the sibling app; this just renders it compactly). */
function SearchManual({ styles, onClose }: { styles: Styles; onClose: () => void }) {
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
function Breadcrumb({ styles, crumbs }: { styles: Styles; crumbs: Crumb[] }) {
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
  styles,
  options,
  selection,
  activeCount,
  open,
  onToggleOpen,
  onToggleValue,
  onClear,
}: {
  styles: Styles;
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

function makeStyles(t: BrowseTheme, taxTileHeight: number) {
  return StyleSheet.create({
    browser: { flex: 1 },
    // The list must claim the remaining sheet height (sibling of the fixed-height controls)
    // so it gets a bounded, scrollable viewport instead of growing to full content height.
    list: { flex: 1 },
    analyticsContent: { padding: 12 },
    tabRow: { flexDirection: 'row', gap: 6 },
    tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
    tabOn: { backgroundColor: t.selected },
    tabText: { fontSize: 13, fontWeight: '700', color: t.subtext },
    tabTextOn: { color: t.text },
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
    pocketSimilar: {
      borderWidth: 1,
      borderColor: t.accent,
      backgroundColor: t.selected,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    pocketSimilarText: { fontSize: 12, fontWeight: '600', color: t.link },
    helpBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    helpBtnOn: { backgroundColor: t.accent, borderColor: t.accent },
    helpBtnText: { fontSize: 14, fontWeight: '700', color: t.subtext },
    helpBtnTextOn: { color: t.accentText },
    // search manual panel
    manual: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      padding: 10,
      gap: 8,
      backgroundColor: t.panel,
    },
    manualHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    manualTitle: { fontSize: 13, fontWeight: '700', color: t.text },
    manualSection: { gap: 3 },
    manualSectionTitle: {
      fontSize: 11,
      fontWeight: '700',
      color: t.subtext,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    manualRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
    manualCode: {
      fontFamily: 'monospace',
      fontSize: 12,
      color: t.link,
      minWidth: 118,
    },
    manualDesc: { flex: 1, fontSize: 12, color: t.subtext, lineHeight: 16 },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    meta: { fontSize: 12, color: t.subtext, flexShrink: 1 },
    clear: { fontSize: 13, fontWeight: '600', color: t.accent },
    // facet bar
    facetBar: { gap: 6 },
    facetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    facetToggle: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
    },
    facetToggleOn: { borderColor: t.accent },
    facetToggleText: { fontSize: 12, fontWeight: '600', color: t.subtext },
    facetToggleTextOn: { color: t.accent },
    facetRows: { gap: 4 },
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
    // list
    column: { gap: GRID_GAP, justifyContent: 'flex-start' },
    listContent: { paddingBottom: 16 },
    empty: { textAlign: 'center', color: t.subtext, marginTop: 24, fontSize: 13 },
    footer: { paddingTop: 4 },
    // series/set grid tiles
    taxTile: {
      height: taxTileHeight,
      marginBottom: ROW_GAP,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 10,
      padding: 8,
      gap: 4,
      backgroundColor: t.panel,
    },
    taxLogoWrap: {
      height: 52,
      borderRadius: 6,
      backgroundColor: t.imagePlaceholder,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    taxLogo: { width: '100%', height: '100%' },
    taxInitial: { fontSize: 22, fontWeight: '800', color: t.faint },
    taxTitle: { fontSize: 12, fontWeight: '700', color: t.text, lineHeight: 15 },
    taxMeta: { fontSize: 10, color: t.subtext, lineHeight: 13 },
    // dense card tiles
    cardTile: { marginBottom: ROW_GAP },
    cardTileSelected: { backgroundColor: t.selected, borderRadius: 6 },
    cardImageWrap: {
      width: '100%',
      aspectRatio: 63 / 88,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: t.imagePlaceholder,
    },
    cardImage: { width: '100%', height: '100%' },
    cardImageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    cardImageFallbackText: { color: t.faint, fontSize: 8 },
    // inline quick-action pill: top-right of the thumb, accent-filled
    cardQuick: {
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
    cardQuickText: { color: t.accentText, fontSize: 11, fontWeight: '800', lineHeight: 14 },
    cardName: { fontSize: 9, lineHeight: 12, marginTop: 2, color: t.subtext, textAlign: 'center' },
    cardValue: { fontSize: 9, lineHeight: 12, fontWeight: '700', color: t.accent, textAlign: 'center' },
    // breadcrumb
    bcBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    bcItem: { flexDirection: 'row', alignItems: 'center' },
    bcSep: { fontSize: 13, color: t.faint, marginHorizontal: 6 },
    bcCrumb: { fontSize: 13 },
    bcLink: { color: t.accent, fontWeight: '600' },
    bcCurrent: { color: t.subtext },
  });
}
