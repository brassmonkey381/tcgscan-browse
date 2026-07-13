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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FlatList,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  describeQuery,
  parseQuery,
  QUERY_HINT,
  QUERY_MANUAL,
  runQuery,
  sortCards,
  type QuerySort,
  type SortDir,
} from './query';
import { browseState, subscribeBrowseCommand } from './state';
import { CardActionModal, MultiCardActionModal } from './CardActionModal';
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
  useCatalogStatus,
  type Catalog,
  type CatalogCard,
  type CatalogLoadStatus,
  type CatalogSeries,
  type CatalogSet,
  type VUnionGroup,
} from './catalog';
import { cardThumbUrl } from './config';
import { useImageManifest } from './images';
import { formatUsd, usePriceSummary } from './prices';
import { findSimilar, findSimilarToMany, findSimilarWeighted, similarAvailable, type SimilarStep } from './similar';
import {
  fetchCardsByIds,
  fetchSetCards,
  searchCards,
  searchFacets,
  serverSearchAvailable,
} from './search';
import { useTaxonomy, type TaxonomySource } from './taxonomy';
import { resolveTheme, type BrowseTheme } from './theme';

/** Rows of cards revealed per "page" — the grid renders this many, then grows on scroll
 *  (infinite scroll). Full result sets aren't capped; the FlatList just virtualizes them. */
const PAGE_SIZE = 90;
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

/** Gapless HP buckets (from the corpus HP distribution) — categorical chips for the HP facet. */
const HP_BUCKETS: { label: string; max: number }[] = [
  { label: '≤ 60', max: 60 },
  { label: '70–100', max: 100 },
  { label: '110–150', max: 150 },
  { label: '160–200', max: 200 },
  { label: '210+', max: Infinity },
];
function hpBucket(hp: number): string {
  return (HP_BUCKETS.find((b) => hp <= b.max) ?? HP_BUCKETS[HP_BUCKETS.length - 1]).label;
}

/** Evolution-stage chip labels, indexed by the 1-indexed evolutionStage (Basic = 1). */
const EVO_LABELS = ['Basic', 'Stage 1', 'Stage 2', 'Stage 3+'];
function evoLabel(stage: number): string {
  return EVO_LABELS[Math.min(stage - 1, EVO_LABELS.length - 1)] ?? EVO_LABELS[0];
}
/** Keep facet chips in a fixed order (not alphabetized), dropping labels absent from `cards`. */
function orderedPresent(labels: string[], cards: CatalogCard[], labelOf: (c: CatalogCard) => string | null): string[] {
  const present = new Set(cards.map(labelOf).filter((v): v is string => v != null));
  return labels.filter((l) => present.has(l));
}

/** UI sort control: the fields the sort chips offer + each field's natural default direction. */
const SORT_OPTIONS: { field: QuerySort; label: string }[] = [
  { field: 'relevance', label: 'Relevance' },
  { field: 'value', label: 'Value' },
  { field: 'date', label: 'Date' },
  { field: 'hp', label: 'HP' },
  { field: 'stage', label: 'Evolution' },
  { field: 'name', label: 'Name' },
];
const SORT_DEFAULT_DIR: Record<QuerySort, SortDir> = {
  relevance: 'desc',
  value: 'desc',
  date: 'desc',
  name: 'asc',
  hp: 'desc',
  stage: 'asc',
};

/** Display order for cold-mode facet values (server returns them unordered). */
function orderFacetValues(key: string, values: string[]): string[] {
  const uniq = [...new Set(values)];
  if (key === 'hp') {
    const order = HP_BUCKETS.map((b) => b.label);
    return uniq.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  if (key === 'evolution') return uniq.sort((a, b) => EVO_LABELS.indexOf(a) - EVO_LABELS.indexOf(b));
  if (key === 'size') return uniq.sort((a, b) => (a === 'Standard' ? -1 : b === 'Standard' ? 1 : 0));
  if (key === 'year') return uniq.sort().reverse(); // newest first, like the warm facet
  return uniq.sort();
}

/** tqdm-style one-liner for the load badge: "☁ Server search · full browse 45% · 3.2/8.8 MB · 4s left". */
function loadLabel(s: CatalogLoadStatus, coldSearch: boolean): string {
  // No load in flight (e.g. guests: the app never requests the catalog) — server search IS the
  // mode, don't imply a download is coming.
  if (s.status === 'idle') return coldSearch ? '☁ Server search — instant' : 'Loading cards…';
  if (s.status === 'error')
    return coldSearch ? '☁ Server search — instant' : 'Catalog failed to load — pull to retry';
  const prefix = coldSearch ? '☁ Server search · full browse' : 'Loading cards';
  const pct = Math.round(s.progress * 100);
  const mb = (n: number) => (n / 1e6).toFixed(1);
  const bytes =
    s.status === 'downloading' && s.receivedBytes > 0
      ? ` · ${mb(s.receivedBytes)}/${mb(s.totalBytes)} MB`
      : '';
  const eta = s.etaSeconds > 0 ? ` · ${s.etaSeconds}s left` : '';
  return `${prefix} ${pct}%${bytes}${eta}`;
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
  {
    // Card footprint. 'Standard' / 'Jumbo' come off each card's kind and filter cards
    // normally; 'V-UNION' is injected as a value in the component (it has no per-card
    // signal) and, when selected, surfaces assembled V-UNION group tiles — see the `data`
    // memo. Selecting only 'V-UNION' matches no plain card (correct: groups show instead).
    key: 'size',
    label: 'Size',
    valuesOf: (c) => [c.kind === 'jumbo' ? 'Jumbo' : 'Standard'],
    available: (cards) => distinctSorted(cards, (c) => [c.kind === 'jumbo' ? 'Jumbo' : 'Standard']),
  },
  {
    // Printed HP, bucketed into categorical chips (the query grammar's hp>N is finer-grained).
    key: 'hp',
    label: 'HP',
    valuesOf: (c) => (c.hp == null ? [] : [hpBucket(c.hp)]),
    available: (cards) =>
      orderedPresent(HP_BUCKETS.map((b) => b.label), cards, (c) => (c.hp == null ? null : hpBucket(c.hp))),
  },
  {
    // Evolution stage, driven by evolution_stage_index (Basic / Stage 1 / Stage 2), NOT the TCG
    // `stage` string. The grammar's stage>N filters this same 1-indexed value.
    key: 'evolution',
    label: 'Evolution',
    valuesOf: (c) => (c.evolutionStage > 0 ? [evoLabel(c.evolutionStage)] : []),
    available: (cards) =>
      orderedPresent(EVO_LABELS, cards, (c) => (c.evolutionStage > 0 ? evoLabel(c.evolutionStage) : null)),
  },
];

/** Synthetic Size facet value that switches the browse to V-UNION group tiles. */
const VUNION_SIZE = 'V-UNION';

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
  | { kind: 'card'; card: CatalogCard }
  | { kind: 'vunion'; group: VUnionGroup };

/** Modifier flags read off a web keyboard event (DOM lib isn't in the RN typings). */
type KeyModifiers = { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean };

type Styles = ReturnType<typeof makeStyles>;

interface CatalogBrowserProps {
  /**
   * The in-memory catalog. Pass `undefined`/`null` while it's still loading to get the COLD
   * path: text search runs against the data server's `search_cards` RPC (instant, no catalog),
   * and the drill-down / facets / similar surface once the catalog resolves (the consumer just
   * passes it through from `useCatalog`). When set, everything is on-device as before.
   */
  catalog?: Catalog | null;
  /** The card currently placed in the pocket (for the selected highlight), if any. */
  selectedCardId?: string;
  /**
   * Legacy/default primary action. When supplied and `cardActions` is omitted, the sheet
   * shows a "Place in pocket" / Replace "<occupant>" primary that calls this — preserving
   * poke-michi's binder behavior. Apps with a richer action set pass `cardActions` instead.
   */
  onPickCard?: (cardId: string) => void;
  /**
   * Place an assembled V-UNION (its four ordered piece ids) — the Size=V-UNION group tiles
   * call this. Omit if the app can't place a 2×2 V-UNION (the group tiles then no-op).
   */
  onPickVUnion?: (pieces: readonly string[]) => void;
  /**
   * Multi-select batch placement: the ids selected via Ctrl/Shift-click (web). Wired to the
   * "Add all to a binder" action. Omit to hide that action (e.g. surfaces with no binder).
   */
  onPickCards?: (cardIds: string[]) => void;
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
  /**
   * One-shot "find similar to all" seed: card ids to run a multi-card similarity search on
   * as soon as this browser mounts. Unlike `sendBrowseCommand({type:'similarMany'})`, this is
   * an explicit prop, so it can't be intercepted by another `CatalogBrowser` mounted elsewhere
   * on the screen — the binder picker uses it so its seed survives the per-pocket remount.
   * Applied once per distinct array reference (pass a fresh array to re-run).
   */
  initialSimilar?: string[];
}

/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export function CatalogBrowser({
  catalog,
  selectedCardId,
  onPickCard,
  onPickVUnion,
  onPickCards,
  cardActions,
  quickAction,
  onOpenCard,
  footer,
  analytics,
  theme: themeProp,
  cardTileWidth = TARGET_TILE_W,
  taxTileHeight = TAX_TILE_H,
  initialSimilar,
}: CatalogBrowserProps) {
  const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
  const styles = useMemo(() => makeStyles(theme, taxTileHeight), [theme, taxTileHeight]);
  // Hydrate the content-hashed image manifest and repaint tiles when it lands —
  // card images resolve by id (cardThumbUrl), not from URLs in the catalog.
  useImageManifest();
  // Catalog load phase — drives the search-source badge (on-device vs, later, server search).
  const catalogStatus = useCatalogStatus();

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
  // UI sort control: null → follow the search box's `sort:` (else relevance).
  const [sortSel, setSortSel] = useState<{ field: QuerySort; dir: SortDir } | null>(
    browseState.sortSel,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // "Find similar" mode: results of the data server's embedding RPC for one card.
  const [similarTo, setSimilarTo] = useState<{ ids: string[]; name: string } | null>(
    browseState.similarTo,
  );
  const [similarCards, setSimilarCards] = useState<CatalogCard[]>(browseState.similarCards);
  // The ongoing similarity session (seed + every more/less refinement) — see similar.ts.
  const [similarSteps, setSimilarSteps] = useState<SimilarStep[]>(browseState.similarSteps);

  // Cold path (catalog not loaded yet): text search runs against the server's search_cards RPC.
  // We accumulate pages, guarding against out-of-order responses with a monotonic request token.
  const warm = Boolean(catalog);
  const coldSearch = !warm && serverSearchAvailable();
  const [serverCards, setServerCards] = useState<CatalogCard[]>([]);
  const [serverPrice, setServerPrice] = useState<Record<string, number>>({});
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  // Cold facet bar: facet key → values for the current query (search_facets, exclude-self).
  const [serverFacets, setServerFacets] = useState<Record<string, string[]>>({});
  const serverOffset = useRef(0);
  const serverToken = useRef(0);
  // Cold drill-down: the tiny public taxonomy stands in for the catalog's series/sets, and a
  // set's cards are fetched from the server on drill (cached per set in the search module).
  const taxonomy = useTaxonomy(coldSearch);
  const tax: TaxonomySource | null = catalog ?? taxonomy;
  const [coldSetCards, setColdSetCards] = useState<CatalogCard[]>([]);
  const [coldSetLoading, setColdSetLoading] = useState(false);
  useEffect(() => {
    if (catalog || !setId || !coldSearch) {
      setColdSetCards([]);
      return;
    }
    let stale = false;
    setColdSetLoading(true);
    fetchSetCards(setId).then((cards) => {
      if (stale) return;
      setColdSetCards(cards);
      setColdSetLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [catalog, coldSearch, setId]);
  /** Resolve ids to cards: catalog when warm, a server fetch when cold. */
  const resolveIds = useCallback(
    async (ids: string[]): Promise<CatalogCard[]> => {
      if (catalog) {
        return ids.map((id) => catalog.getCard(id)).filter((c): c is CatalogCard => Boolean(c));
      }
      return fetchCardsByIds(ids);
    },
    [catalog],
  );
  /** Best-effort synchronous lookup for thumbs/sheets: catalog, else the current view. */
  const findCard = (id: string): CatalogCard | undefined =>
    catalog?.getCard(id) ?? viewCardsRef.current.find((c) => c.id === id);
  const viewCardsRef = useRef<CatalogCard[]>([]);

  // Write every change back so the next mount resumes here.
  useEffect(() => {
    Object.assign(browseState, {
      cardQuery,
      seriesId,
      setId,
      selection,
      sortSel,
      similarTo,
      similarCards,
      similarSteps,
    });
  }, [cardQuery, seriesId, setId, selection, sortSel, similarTo, similarCards, similarSteps]);
  // Tapping a card opens the action sheet (app-supplied actions + built-ins)
  // instead of silently replacing the pocket's occupant.
  const [actionCard, setActionCard] = useState<CatalogCard | null>(null);

  // Multi-select (WEB ONLY): Ctrl/Shift-click toggles cards into `selectedIds`; releasing the
  // modifier with 2+ selected opens the batch sheet. Native has no modifier keys, so this stays
  // dormant there. modifierHeld/selectedIdsRef mirror live values for the window keyup listener
  // (registered once) without re-binding it each render.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [multiOpen, setMultiOpen] = useState(false);
  // Explicit select mode — the cross-platform path (native has no Ctrl/Shift): toggle it on,
  // tap cards to select, then "Continue". Web additionally supports Ctrl/Shift-click.
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const modifierHeld = useRef(false);
  const selectedIdsRef = useRef<string[]>([]);
  selectedIdsRef.current = selectedIds;
  const clearSelection = () => setSelectedIds([]);
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const g = globalThis as {
      addEventListener?: (t: string, cb: (e: KeyModifiers) => void) => void;
      removeEventListener?: (t: string, cb: (e: KeyModifiers) => void) => void;
    };
    if (!g.addEventListener) return;
    const down = (e: KeyModifiers) => {
      if (e.ctrlKey || e.shiftKey || e.metaKey) modifierHeld.current = true;
    };
    const up = (e: KeyModifiers) => {
      if (e.ctrlKey || e.shiftKey || e.metaKey) return; // another modifier still down
      modifierHeld.current = false;
      if (selectedIdsRef.current.length >= 2) setMultiOpen(true);
    };
    g.addEventListener('keydown', down);
    g.addEventListener('keyup', up);
    return () => {
      g.removeEventListener?.('keydown', down);
      g.removeEventListener?.('keyup', up);
    };
  }, []);
  // Cards | Analytics toggle within a set OR a series (only when `analytics` is enabled).
  // Resets to the card/set grid whenever the drilled-into series or set changes.
  const [analyticsTab, setAnalyticsTab] = useState<'cards' | 'analytics'>('cards');
  useEffect(() => {
    setAnalyticsTab('cards');
  }, [seriesId, setId]);

  // Headline card values (load-once) — powers >$N queries, sort:value, and value labels.
  // Warm: the price summary. Cold: the `cur` the RPC returned with each hit.
  const priceSummary = usePriceSummary();
  // The public price summary serves both tiers; cold search hits also carry their own `cur`.
  const priceOf = (id: string) => priceSummary?.[id]?.cur ?? serverPrice[id] ?? 0;

  // Measured content width → dense column count. 0 until the first layout pass.
  const [containerWidth, setContainerWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - containerWidth) > 0.5) setContainerWidth(w);
  };

  const clearFilters = () => setSelection({});

  const q = cardQueryDebounced.trim();
  const searching = q.length > 0;
  // Cold (no catalog): search + similar are server-backed, and the drill-down runs off the
  // tiny public taxonomy (per-set cards fetched on drill). 'coldidle' only while the taxonomy
  // itself is still loading / unavailable.
  const level: 'search' | 'similar' | 'cards' | 'sets' | 'series' | 'coldidle' = searching
    ? 'search'
    : similarTo
      ? 'similar'
      : !tax
        ? 'coldidle'
        : setId
          ? 'cards'
          : seriesId
            ? 'sets'
            : 'series';
  const isCardLevel = level === 'cards' || level === 'search' || level === 'similar';

  const series = useMemo(() => tax?.listSeries() ?? [], [tax]);
  const sets = useMemo(() => (tax && seriesId ? tax.listSets(seriesId) : []), [tax, seriesId]);

  // The parsed search-box query (grammar: words, key:value fields, price bounds, sort).
  const parsed = useMemo(() => parseQuery(q), [q]);
  // Effective sort: the UI sort control wins; otherwise the search box's `sort:` (or relevance).
  const effSort = useMemo<{ field: QuerySort; dir: SortDir }>(() => {
    if (sortSel) return sortSel;
    if (parsed.sort !== 'relevance') return { field: parsed.sort, dir: parsed.sortDir };
    return { field: 'relevance', dir: 'desc' };
  }, [sortSel, parsed.sort, parsed.sortDir]);
  // The query actually run/described/labelled, with the effective sort folded in.
  const effParsed = useMemo(
    () => ({ ...parsed, sort: effSort.field, sortDir: effSort.dir }),
    [parsed, effSort],
  );

  // Cards currently in view, before facet filtering: ranked full-corpus search results
  // (bare words match name/artist/set/series/rarity/type/stage — name hits rank first),
  // similar-mode results, or the set's cards.
  const viewCards = useMemo<CatalogCard[]>(() => {
    // Cold search: the accumulated server-search pages.
    if (!catalog && searching) return serverCards;
    if (catalog && searching) return runQuery(catalog.listAll(), effParsed, priceOf, Infinity);
    // Set cards / similar results (warm from the catalog, cold from the per-set fetch): keep
    // their natural order (collector number / best-match) until the UI sort control asks for
    // something else, then re-sort by the chosen field.
    const base = similarTo ? similarCards : setId ? (catalog ? catalog.listCards(setId) : coldSetCards) : [];
    if (effSort.field === 'relevance' || base.length === 0) return base;
    return sortCards(base, effParsed, priceOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, searching, serverCards, coldSetCards, effParsed, effSort.field, setId, similarTo, similarCards, priceSummary]);
  viewCardsRef.current = viewCards;

  // Cold search: (re)fetch page 0 when the query/sort/facet selection changes; the token guard
  // drops stale responses. A page's `total` + prices land in state for the header/tiles.
  const fetchServerPage = useCallback(
    async (offset: number, replace: boolean) => {
      const token = ++serverToken.current;
      setServerLoading(true);
      const page = await searchCards(effParsed, { limit: PAGE_SIZE, offset, facets: selection });
      if (serverToken.current !== token) return; // a newer request superseded this one
      serverOffset.current = offset + page.cards.length;
      setServerTotal(page.total);
      setServerPrice((prev) => (replace ? page.priceById : { ...prev, ...page.priceById }));
      setServerCards((prev) => (replace ? page.cards : [...prev, ...page.cards]));
      setServerLoading(false);
    },
    [effParsed, selection],
  );
  useEffect(() => {
    if (!coldSearch || !searching) {
      setServerCards([]);
      setServerTotal(0);
      setServerFacets({});
      serverOffset.current = 0;
      return;
    }
    fetchServerPage(0, true);
    // Facet options for the same query (exclude-self server-side) — drives the cold facet bar.
    let stale = false;
    searchFacets(effParsed, selection).then((f) => {
      if (!stale) setServerFacets(f);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coldSearch, searching, fetchServerPage]);

  // Ids currently in view (search results / set cards) — keeps facet options and the V-UNION
  // groups relevant to what's actually on screen.
  const inView = useMemo(() => new Set(viewCards.map((c) => c.id)), [viewCards]);
  // Offer the Size=V-UNION option only when a group's pieces are actually in view.
  const hasVUnionInView = useMemo(
    () => (catalog?.vunionGroups() ?? []).some((g) => g.pieces.some((pid) => inView.has(pid))),
    [catalog, inView],
  );

  // Facet options narrow to the searched/filtered subset: each facet's values are the ones
  // present after the OTHER facets' selections are applied (exclude self, so you can still
  // change this facet). Standard faceted search — one pass per facet, not recursive. Facets
  // with <2 options in the subset drop out. Cold (server search): the same options come from
  // the search_facets RPC (exclude-self computed server-side); V-UNION stays warm-only.
  // Whether the current view is a COMPLETE local card list (warm anything, or a cold set /
  // similar view). Then facets + filtering run client-side over it, exactly like warm; only
  // cold SEARCH (server-paginated, not fully local) uses the server-computed facet values.
  const localView = Boolean(catalog) || !searching;
  const facetOptions = useMemo(() => {
    if (!isCardLevel) return [];
    if (!localView) {
      if (!coldSearch) return [];
      return FACETS.map((f) => {
        const selected = selection[f.key] ?? [];
        const values = orderFacetValues(f.key, [...(serverFacets[f.key] ?? []), ...selected]);
        return { facet: f, values };
      }).filter((o) => o.values.length >= 2 || (selection[o.facet.key]?.length ?? 0) > 0);
    }
    return FACETS.map((f) => {
      const subset = applyFacets(viewCards, { ...selection, [f.key]: [] });
      const selected = selection[f.key] ?? [];
      // Currently-selected values ALWAYS stay visible (even if absent from the subset), so a
      // filter that now matches nothing is still deselectable — never a silent stuck 0.
      const values = [...new Set([...f.available(subset), ...selected])];
      if (f.key === 'size' && hasVUnionInView && !values.includes(VUNION_SIZE)) {
        values.push(VUNION_SIZE);
      }
      return { facet: f, values };
    }).filter((o) => o.values.length >= 2 || (selection[o.facet.key]?.length ?? 0) > 0);
  }, [isCardLevel, localView, coldSearch, serverFacets, viewCards, selection, hasVUnionInView]);

  // Local views filter client-side; cold search results arrive already facet-filtered.
  const filteredCards = useMemo(
    () => (localView ? applyFacets(viewCards, selection) : viewCards),
    [localView, viewCards, selection],
  );
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

  // Size=V-UNION surfaces assembled group tiles (no per-card signal exists for them). Shown
  // ahead of any plain cards the rest of the Size selection matches (Standard/Jumbo).
  const showVUnionGroups = isCardLevel && catalog && (selection.size ?? []).includes(VUNION_SIZE);
  const data = useMemo<BrowseItem[]>(() => {
    if (level === 'series') return series.map((s) => ({ kind: 'series' as const, series: s }));
    if (level === 'sets') return sets.map((s) => ({ kind: 'set' as const, set: s }));
    const cards = filteredCards.map((c) => ({ kind: 'card' as const, card: c }));
    if (!showVUnionGroups || !catalog) return cards;
    // Only groups relevant to the CURRENT view: a group qualifies when one of its piece cards is
    // in the searched/set cards. So "charizard" + V-UNION returns nothing (no Charizard V-UNION),
    // while "greninja" surfaces the Greninja group. Without this every group shows on every query.
    const groups = catalog
      .vunionGroups()
      .filter((g) => g.pieces.some((pid) => inView.has(pid)))
      .map((g) => ({ kind: 'vunion' as const, group: g }));
    return [...groups, ...cards];
  }, [level, series, sets, filteredCards, inView, showVUnionGroups, catalog]);

  // Warm the first row of card images through the cache once per distinct view (set/filter/
  // search change), off the render path. Guarded so it fires at most once per view key.
  const prefetchedKey = useRef<string | null>(null);
  const viewKey = `${level}:${setId ?? ''}:${q}:${JSON.stringify(selection)}`;
  // Infinite scroll: reveal a page of rows, grow on end-reached. Reset to the top when the
  // view (level/search/filters) or the sort changes.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [viewKey, effSort.field, effSort.dir]);
  // Local views paginate client-side (slice a growing window). Cold SEARCH paginates on the
  // server, so show every page fetched so far.
  const visibleData = useMemo(
    () => (localView ? data.slice(0, visibleCount) : data),
    [localView, data, visibleCount],
  );
  // End-reached: grow the client window (local views) or fetch the next server page.
  const onEndReached = () => {
    if (!localView) {
      if (coldSearch && !serverLoading && serverCards.length < serverTotal) {
        fetchServerPage(serverOffset.current, false);
      }
      return;
    }
    setVisibleCount((n) => (n < data.length ? Math.min(n + PAGE_SIZE, data.length) : n));
  };
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
    setSimilarSteps([]);
  };
  // "· refined +2 −1" summary for the similar-mode header (counts of more/less steps).
  const moreCount = similarSteps.filter((st) => st.kind === 'more').length;
  const lessCount = similarSteps.filter((st) => st.kind === 'less').length;
  const refineNote =
    moreCount || lessCount
      ? ` · refined${moreCount ? ` +${moreCount}` : ''}${lessCount ? ` −${lessCount}` : ''}`
      : '';
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
    setSimilarTo({ ids: [card.id], name: card.name });
    setSimilarCards([]);
    setSimilarSteps([{ kind: 'seed', ids: [card.id] }]);
    findSimilar(card.id, 24).then(async (hits) => {
      setSimilarCards(await resolveIds(hits.map((h) => h.id)));
    });
  };

  /** "Find similar to all" — embedding search on the AVERAGE of the selected cards' vectors
   *  (find_similar_to_cards server-side). Results replace the grid, like openSimilar. */
  const openSimilarMany = (ids: string[]) => {
    setCardQuery('');
    setCardQueryDebounced('');
    clearFilters();
    setSimilarTo({ ids: [...ids], name: `${ids.length} cards` });
    setSimilarCards([]);
    setSimilarSteps([{ kind: 'seed', ids: [...ids] }]);
    findSimilarToMany(ids, 24).then(async (hits) => {
      setSimilarCards(await resolveIds(hits.map((h) => h.id)));
    });
  };

  /** "More / less like this" — extend the ONGOING similarity session and re-rank against the
   *  weighted (Rocchio) history: seed 1.0, each more-group +0.8, each less-group −0.5, split
   *  across group members (see similar.ts refineWeights). Seed chips stay; the grid re-ranks. */
  const refineSimilar = (kind: 'more' | 'less', ids: string[]) => {
    const steps: SimilarStep[] = [...similarSteps, { kind, ids }];
    setSimilarSteps(steps);
    setSimilarCards([]);
    findSimilarWeighted(steps, 24).then(async (hits) => {
      setSimilarCards(await resolveIds(hits.map((h) => h.id)));
    });
  };

  // Multi-select is only meaningful when at least one batch action can run.
  const canMultiSelect = Boolean(onPickCards) || similarAvailable();
  // Read live at press time (modifierHeld is a ref → no re-render on key state change).
  const isSelecting = () =>
    canMultiSelect && (multiSelectMode || (Platform.OS === 'web' && modifierHeld.current));

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
      if (cmd.type === 'similarMany') {
        openSimilarMany(cmd.cardIds);
        return;
      }
      if (cmd.type === 'viewSetById') {
        // Catalog-free set jump (cold mode fetches the set's cards server-side).
        setCardQuery('');
        setCardQueryDebounced('');
        clearSimilar();
        clearFilters();
        setSeriesId(cmd.seriesId ?? null);
        setSetId(cmd.setId);
        return;
      }
      const card = catalog?.getCard(cmd.cardId);
      if (!card) return;
      if (cmd.type === 'similar') openSimilar(card);
      else if (cmd.type === 'viewSet') jumpToSet(card);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  // One-shot "find similar to all" seed from a host (the binder picker): run the multi-card
  // search on mount, bypassing the broadcast command bus so a second mounted browser can't
  // steal it. Ref-guarded → applied once per distinct seed array (a fresh open passes a new ref).
  const appliedSimilarRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!initialSimilar || initialSimilar.length === 0) return;
    if (appliedSimilarRef.current === initialSimilar) return;
    appliedSimilarRef.current = initialSimilar;
    openSimilarMany(initialSimilar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSimilar]);

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

  // Sort chips: tap a field to sort by it; tap the active field again (or the ↑/↓ button) to
  // flip its direction. Relevance has no direction.
  const pickSort = (field: QuerySort) => {
    if (field === effSort.field && field !== 'relevance') {
      setSortSel({ field, dir: effSort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortSel({ field, dir: field === 'relevance' ? 'desc' : SORT_DEFAULT_DIR[field] });
    }
  };
  const toggleSortDir = () =>
    setSortSel({ field: effSort.field, dir: effSort.dir === 'asc' ? 'desc' : 'asc' });

  const currentSeries = tax && seriesId ? tax.getSeries(seriesId) : undefined;
  const currentSet = tax && setId ? tax.getSet(setId) : undefined;
  // The card already in the pocket that opened this picker (if any) — offered as
  // a one-tap "find similar to what's here" jump.
  const occupant = catalog && selectedCardId ? catalog.getCard(selectedCardId) : undefined;
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
    // Refinements exist only while similarity results are on screen — they extend the session.
    moreLikeThis:
      similarAvailable() && similarTo
        ? {
            key: 'more-like-this',
            label: '⊕ More like this',
            onPress: (c) => {
              setActionCard(null);
              refineSimilar('more', [c.id]);
            },
          }
        : undefined,
    lessLikeThis:
      similarAvailable() && similarTo
        ? {
            key: 'less-like-this',
            label: '⊖ Less like this',
            onPress: (c) => {
              setActionCard(null);
              refineSimilar('less', [c.id]);
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
      builtins.moreLikeThis,
      builtins.lessLikeThis,
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
        : item.kind === 'vunion'
          ? `vu-${item.group.pieces.join('-')}`
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
    if (item.kind === 'vunion') {
      const g = item.group;
      return <VUnionTile styles={styles} group={g} width={tileW} onPress={() => onPickVUnion?.(g.pieces)} />;
    }
    const c = item.card;
    const value = priceOf(c.id);
    return (
      <CardTile
        styles={styles}
        card={c}
        width={tileW}
        selected={c.id === selectedCardId}
        // In select mode (toggle, or web Ctrl/Shift) a tap toggles selection; else it opens
        // the single-card sheet.
        onPress={() => (isSelecting() ? toggleSelected(c.id) : setActionCard(c))}
        multiSelected={selectedIds.includes(c.id)}
        // value replaces the name line when sorting by value (keeps row geometry fixed)
        label={effParsed.sort === 'value' && value > 0 ? formatUsd(value) : c.name}
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
            placeholder={`Search ${tax?.cardCount ? tax.cardCount.toLocaleString() + ' ' : ''}cards — ${QUERY_HINT}`}
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
        {/* Search-source badge: ⚡ on-device (catalog in memory) once warm, else ☁ server search
            with a tqdm-style download bar (% · MB · ETA) while the catalog loads. */}
        {isCardLevel || !warm ? (
          <View>
            <View style={styles.modeBadge}>
              <View style={[styles.modeDot, warm ? styles.modeDotReady : styles.modeDotLoading]} />
              <Text style={styles.modeText} numberOfLines={1}>
                {warm ? '⚡ On-device search — instant' : loadLabel(catalogStatus, coldSearch)}
              </Text>
            </View>
            {!warm && catalogStatus.status !== 'error' ? (
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${Math.round(catalogStatus.progress * 100)}%` }]}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {helpOpen ? <SearchManual styles={styles} onClose={() => setHelpOpen(false)} /> : null}
        {occupant &&
        similarAvailable() &&
        !(similarTo?.ids.length === 1 && similarTo.ids[0] === occupant.id) ? (
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
              {warm
                ? filteredCards.length === viewCards.length
                  ? `${viewCards.length} result${viewCards.length === 1 ? '' : 's'}`
                  : `${filteredCards.length} of ${viewCards.length}`
                : `${serverTotal} result${serverTotal === 1 ? '' : 's'}${serverLoading ? '…' : ''}`}
              {' · '}
              {describeQuery(effParsed, viewCards)}
            </Text>
            <Pressable onPress={() => onChangeQuery('')} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          </View>
        ) : similarTo ? (
          <View style={styles.similarBar}>
            <View style={styles.metaRow}>
              <Text style={styles.meta} numberOfLines={1}>
                {similarCards.length > 0
                  ? `${filteredCards.length} cards similar to${similarTo.ids.length > 1 ? ' all of' : ''}${refineNote}:`
                  : 'Finding similar cards…'}
              </Text>
              <Pressable onPress={clearSimilar} hitSlop={8}>
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            </View>
            {/* The source card(s) the similarity ran on — tap one to open its sheet. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.similarThumbs}
              keyboardShouldPersistTaps="handled">
              {similarTo.ids.map((sid) => {
                const src = findCard(sid);
                const uri = cardThumbUrl(sid, 245);
                return (
                  <Pressable
                    key={sid}
                    style={styles.similarThumb}
                    onPress={() => src && setActionCard(src)}>
                    {uri ? (
                      <Image
                        source={{ uri }}
                        style={styles.cardImage}
                        contentFit="contain"
                        cachePolicy="memory-disk"
                        recyclingKey={sid}
                        transition={80}
                      />
                    ) : (
                      <View style={styles.cardImageFallback}>
                        <Text style={styles.cardImageFallbackText}>{src?.name?.slice(0, 1) ?? '?'}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
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
        {isCardLevel && !analyticsView ? (
          <SortBar styles={styles} field={effSort.field} dir={effSort.dir} onPick={pickSort} onToggleDir={toggleSortDir} />
        ) : null}
        {isCardLevel && canMultiSelect && !analyticsView ? (
          <View style={styles.selectRow}>
            {multiSelectMode || selectedIds.length > 0 ? (
              <>
                <Text style={styles.selectMeta} numberOfLines={1}>
                  {selectedIds.length} selected{selectedIds.length < 2 ? ' · tap 2+' : ''}
                </Text>
                <Pressable
                  disabled={selectedIds.length < 2}
                  onPress={() => setMultiOpen(true)}
                  style={[styles.selectBtn, selectedIds.length < 2 && styles.selectBtnOff]}>
                  <Text style={styles.selectBtnText}>Continue →</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMultiSelectMode(false);
                    clearSelection();
                  }}
                  hitSlop={8}>
                  <Text style={styles.clear}>Cancel</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => setMultiSelectMode(true)} style={styles.selectToggle}>
                <Text style={styles.selectToggleText}>⊕ Select multiple</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>

      {analyticsView ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.analyticsContent}>
          {catalog && analyticsScope === 'set' && setId ? (
            <SetAnalytics catalog={catalog} setId={setId} onOpenCard={openCard} theme={theme} />
          ) : catalog && analyticsScope === 'series' && seriesId ? (
            <SeriesAnalytics catalog={catalog} seriesId={seriesId} onOpenCard={openCard} theme={theme} />
          ) : null}
        </ScrollView>
      ) : (
      <FlatList
        // Remount when the level or column count changes so numColumns/getItemLayout stay
        // consistent (FlatList can't change numColumns in place).
        key={`lvl-${level}-c${cols}`}
        style={styles.list}
        // Render a growing window of the (uncapped) results — reveal more as you scroll.
        data={visibleData}
        keyExtractor={keyFor}
        renderItem={renderItem}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? styles.column : undefined}
        contentContainerStyle={styles.listContent}
        getItemLayout={getItemLayout}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.8}
        onEndReached={onEndReached}
        initialNumToRender={cols * 6}
        maxToRenderPerBatch={cols * 4}
        windowSize={9}
        removeClippedSubviews
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searching
              ? !warm && serverLoading
                ? 'Searching…'
                : `No cards match “${q}”.`
              : level === 'coldidle'
                ? coldSearch
                  ? 'Type to search all cards.'
                  : 'Loading cards…'
                : level === 'similar'
                  ? similarCards.length === 0 && similarTo
                    ? 'Searching…'
                    : 'No similar cards found.'
                  : level === 'cards'
                    ? !catalog && coldSetLoading
                      ? 'Loading set…'
                      : 'No cards in this set.'
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

      {multiOpen ? (
        <MultiCardActionModal
          cards={selectedIds
            .map((id) => findCard(id))
            .filter((c): c is CatalogCard => Boolean(c))}
          onAddAll={onPickCards ? () => onPickCards(selectedIds) : undefined}
          onFindSimilarAll={similarAvailable() ? () => openSimilarMany(selectedIds) : undefined}
          onMoreLikeAll={
            similarAvailable() && similarTo ? () => refineSimilar('more', selectedIds) : undefined
          }
          onLessLikeAll={
            similarAvailable() && similarTo ? () => refineSimilar('less', selectedIds) : undefined
          }
          onClose={() => {
            setMultiOpen(false);
            setMultiSelectMode(false);
            clearSelection();
          }}
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
  multiSelected,
  onPress,
  label,
  value,
  quickAction,
}: {
  styles: Styles;
  card: CatalogCard;
  width: number;
  selected: boolean;
  /** Checked in multi-select mode (Ctrl/Shift-click / select mode). */
  multiSelected?: boolean;
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
    <Pressable
      style={[styles.cardTile, { width }, selected && styles.cardTileSelected, multiSelected && styles.cardTileMulti]}
      onPress={onPress}>
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
        {multiSelected ? (
          <View style={styles.cardCheck}>
            <Text style={styles.cardCheckText}>✓</Text>
          </View>
        ) : null}
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

/**
 * A V-UNION group tile (Size=V-UNION): the assembled art (its top-left piece thumb) with a
 * V-UNION badge and label. Tapping places the whole 2×2 (onPress → onPickVUnion(pieces)).
 */
function VUnionTile({
  styles,
  group,
  width,
  onPress,
}: {
  styles: Styles;
  group: VUnionGroup;
  width: number;
  onPress: () => void;
}) {
  const uri = cardThumbUrl(group.pieces[0], 245);
  return (
    <Pressable style={[styles.cardTile, { width }]} onPress={onPress}>
      <View style={styles.cardImageWrap}>
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.cardImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={group.pieces[0]}
            transition={100}
          />
        ) : (
          <View style={styles.cardImageFallback}>
            <Text style={styles.cardImageFallbackText}>V-UNION</Text>
          </View>
        )}
        <View style={styles.vunionTag}>
          <Text style={styles.vunionTagText}>V-UNION</Text>
        </View>
      </View>
      <Text style={styles.cardName} numberOfLines={1}>
        {group.label}
      </Text>
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

/**
 * Compact sort control: a "Sort" label, a horizontal row of single-select field chips, and a
 * ↑/↓ direction toggle (hidden for Relevance, which has no direction). Mirrors the FacetBar chip
 * look. The chips drive the SAME sort the search box's `sort:` grammar sets.
 */
function SortBar({
  styles,
  field,
  dir,
  onPick,
  onToggleDir,
}: {
  styles: Styles;
  field: QuerySort;
  dir: SortDir;
  onPick: (field: QuerySort) => void;
  onToggleDir: () => void;
}) {
  return (
    <View style={styles.facetGroup}>
      <Text style={styles.facetLabel}>Sort</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.sortScroll}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled">
        {SORT_OPTIONS.map((o) => {
          const on = o.field === field;
          return (
            <Pressable key={o.field} onPress={() => onPick(o.field)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {field !== 'relevance' ? (
        <Pressable onPress={onToggleDir} style={styles.sortDir} accessibilityLabel="Toggle sort direction">
          <Text style={styles.sortDirText}>{dir === 'asc' ? '↑' : '↓'}</Text>
        </Pressable>
      ) : null}
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
    // search-source badge (on-device / loading / — later — server)
    modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    modeDot: { width: 7, height: 7, borderRadius: 4 },
    modeDotReady: { backgroundColor: t.accent },
    modeDotLoading: { backgroundColor: t.faint },
    modeText: { fontSize: 11, color: t.faint, flexShrink: 1 },
    // tqdm-style catalog-load bar under the badge
    progressTrack: {
      height: 3,
      marginTop: 3,
      borderRadius: 2,
      backgroundColor: t.imagePlaceholder,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: 2, backgroundColor: t.accent },
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
    // "Similar to" source-card strip (the cards the similarity ran on, clickable)
    similarBar: { gap: 6 },
    similarThumbs: { gap: 6, paddingVertical: 2 },
    similarThumb: { width: 34, aspectRatio: 63 / 88, borderRadius: 4, overflow: 'hidden', backgroundColor: t.imagePlaceholder },
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
    // sort control (field chips + a ↑/↓ direction toggle)
    sortScroll: { flexShrink: 1 },
    sortDir: {
      width: 30,
      alignItems: 'center',
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.accent,
    },
    sortDirText: { fontSize: 14, fontWeight: '800', color: t.accent },
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
    // multi-select: highlighted tile + a check badge, top-left of the thumb
    cardTileMulti: { backgroundColor: t.selected, borderRadius: 6, borderWidth: 2, borderColor: t.accent },
    cardCheck: {
      position: 'absolute',
      top: 3,
      left: 3,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCheckText: { color: t.accentText, fontSize: 11, fontWeight: '800', lineHeight: 14 },
    // V-UNION group tile badge (bottom-left of the thumb)
    vunionTag: {
      position: 'absolute',
      bottom: 3,
      left: 3,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    vunionTagText: { color: '#fff', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
    // multi-select control row (mode toggle + Continue)
    selectRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
    selectMeta: { fontSize: 12, color: t.subtext, flexShrink: 1 },
    selectBtn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.accent },
    selectBtnOff: { opacity: 0.4 },
    selectBtnText: { color: t.accentText, fontSize: 12, fontWeight: '700' },
    selectToggle: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: t.border },
    selectToggleText: { fontSize: 12, fontWeight: '600', color: t.link },
    // breadcrumb
    bcBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
    bcItem: { flexDirection: 'row', alignItems: 'center' },
    bcSep: { fontSize: 13, color: t.faint, marginHorizontal: 6 },
    bcCrumb: { fontSize: 13 },
    bcLink: { color: t.accent, fontWeight: '600' },
    bcCurrent: { color: t.subtext },
  });
}
