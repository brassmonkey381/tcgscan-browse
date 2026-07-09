import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, } from 'react-native';
import { describeQuery, parseQuery, QUERY_HINT, QUERY_MANUAL, runQuery } from './query';
import { browseState, subscribeBrowseCommand } from './state';
import { CardActionModal, MultiCardActionModal } from './CardActionModal';
import { SeriesAnalytics, SetAnalytics } from './analytics';
import { resolveActions, } from './actions';
import { formatSetDate, seriesDateRange, } from './catalog';
import { cardThumbUrl } from './config';
import { useImageManifest } from './images';
import { formatUsd, usePriceSummary } from './prices';
import { findSimilar, findSimilarToMany, similarAvailable } from './similar';
import { resolveTheme } from './theme';
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
/** Distinct, alphabetically-sorted values pulled off `cards` via `pick`. */
function distinctSorted(cards, pick) {
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
const FACETS = [
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
        available: (cards) => distinctSorted(cards, (c) => (c.releaseDate ? [c.releaseDate.slice(0, 4)] : [])).reverse(),
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
];
/** Synthetic Size facet value that switches the browse to V-UNION group tiles. */
const VUNION_SIZE = 'V-UNION';
/** Apply the current selection: AND across facets, OR within one facet's values. */
function applyFacets(cards, selection) {
    const active = FACETS.filter((f) => (selection[f.key]?.length ?? 0) > 0);
    if (active.length === 0)
        return cards;
    return cards.filter((card) => active.every((f) => {
        const chosen = selection[f.key];
        return f.valuesOf(card).some((v) => chosen.includes(v));
    }));
}
/**
 * Series → Set → Card browser. Search overrides the drill-down; the facet bar applies to
 * the card-list and search-result levels only.
 */
export function CatalogBrowser({ catalog, selectedCardId, onPickCard, onPickVUnion, onPickCards, cardActions, quickAction, onOpenCard, footer, analytics, theme: themeProp, cardTileWidth = TARGET_TILE_W, taxTileHeight = TAX_TILE_H, }) {
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
    const [seriesId, setSeriesId] = useState(browseState.seriesId);
    const [setId, setSetId] = useState(browseState.setId);
    const [selection, setSelection] = useState(browseState.selection);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    // "Find similar" mode: results of the data server's embedding RPC for one card.
    const [similarTo, setSimilarTo] = useState(browseState.similarTo);
    const [similarCards, setSimilarCards] = useState(browseState.similarCards);
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
    const [actionCard, setActionCard] = useState(null);
    // Multi-select (WEB ONLY): Ctrl/Shift-click toggles cards into `selectedIds`; releasing the
    // modifier with 2+ selected opens the batch sheet. Native has no modifier keys, so this stays
    // dormant there. modifierHeld/selectedIdsRef mirror live values for the window keyup listener
    // (registered once) without re-binding it each render.
    const [selectedIds, setSelectedIds] = useState([]);
    const [multiOpen, setMultiOpen] = useState(false);
    // Explicit select mode — the cross-platform path (native has no Ctrl/Shift): toggle it on,
    // tap cards to select, then "Continue". Web additionally supports Ctrl/Shift-click.
    const [multiSelectMode, setMultiSelectMode] = useState(false);
    const modifierHeld = useRef(false);
    const selectedIdsRef = useRef([]);
    selectedIdsRef.current = selectedIds;
    const clearSelection = () => setSelectedIds([]);
    const toggleSelected = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    useEffect(() => {
        if (Platform.OS !== 'web')
            return;
        const g = globalThis;
        if (!g.addEventListener)
            return;
        const down = (e) => {
            if (e.ctrlKey || e.shiftKey || e.metaKey)
                modifierHeld.current = true;
        };
        const up = (e) => {
            if (e.ctrlKey || e.shiftKey || e.metaKey)
                return; // another modifier still down
            modifierHeld.current = false;
            if (selectedIdsRef.current.length >= 2)
                setMultiOpen(true);
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
    const [analyticsTab, setAnalyticsTab] = useState('cards');
    useEffect(() => {
        setAnalyticsTab('cards');
    }, [seriesId, setId]);
    // Headline card values (load-once) — powers >$N queries, sort:value, and value labels.
    const priceSummary = usePriceSummary();
    const priceOf = (id) => priceSummary?.[id]?.cur ?? 0;
    // Measured content width → dense column count. 0 until the first layout pass.
    const [containerWidth, setContainerWidth] = useState(0);
    const onLayout = (e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - containerWidth) > 0.5)
            setContainerWidth(w);
    };
    const clearFilters = () => setSelection({});
    const q = cardQueryDebounced.trim();
    const searching = q.length > 0;
    const level = searching
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
    const viewCards = useMemo(() => {
        if (searching)
            return runQuery(catalog.listAll(), parsed, priceOf, SEARCH_LIMIT);
        if (similarTo)
            return similarCards;
        if (setId)
            return catalog.listCards(setId);
        return [];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalog, searching, parsed, setId, similarTo, similarCards, priceSummary]);
    // Ids currently in view (search results / set cards) — keeps facet options and the V-UNION
    // groups relevant to what's actually on screen.
    const inView = useMemo(() => new Set(viewCards.map((c) => c.id)), [viewCards]);
    // Offer the Size=V-UNION option only when a group's pieces are actually in view.
    const hasVUnionInView = useMemo(() => catalog.vunionGroups().some((g) => g.pieces.some((pid) => inView.has(pid))), [catalog, inView]);
    // Facet options narrow to the searched/filtered subset: each facet's values are the ones
    // present after the OTHER facets' selections are applied (exclude self, so you can still
    // change this facet). Standard faceted search — one pass per facet, not recursive. Facets
    // with <2 options in the subset drop out.
    const facetOptions = useMemo(() => isCardLevel
        ? FACETS.map((f) => {
            const subset = applyFacets(viewCards, { ...selection, [f.key]: [] });
            const selected = selection[f.key] ?? [];
            // Currently-selected values ALWAYS stay visible (even if absent from the subset), so a
            // filter that now matches nothing is still deselectable — never a silent stuck 0.
            const values = [...new Set([...f.available(subset), ...selected])];
            if (f.key === 'size' && hasVUnionInView && !values.includes(VUNION_SIZE)) {
                values.push(VUNION_SIZE);
            }
            return { facet: f, values };
        }).filter((o) => o.values.length >= 2 || (selection[o.facet.key]?.length ?? 0) > 0)
        : [], [isCardLevel, viewCards, selection, hasVUnionInView]);
    const filteredCards = useMemo(() => applyFacets(viewCards, selection), [viewCards, selection]);
    const activeFilterCount = useMemo(() => Object.values(selection).reduce((n, vals) => n + vals.length, 0), [selection]);
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
    const showVUnionGroups = isCardLevel && (selection.size ?? []).includes(VUNION_SIZE);
    const data = useMemo(() => {
        if (level === 'series')
            return series.map((s) => ({ kind: 'series', series: s }));
        if (level === 'sets')
            return sets.map((s) => ({ kind: 'set', set: s }));
        const cards = filteredCards.map((c) => ({ kind: 'card', card: c }));
        if (!showVUnionGroups)
            return cards;
        // Only groups relevant to the CURRENT view: a group qualifies when one of its piece cards is
        // in the searched/set cards. So "charizard" + V-UNION returns nothing (no Charizard V-UNION),
        // while "greninja" surfaces the Greninja group. Without this every group shows on every query.
        const groups = catalog
            .vunionGroups()
            .filter((g) => g.pieces.some((pid) => inView.has(pid)))
            .map((g) => ({ kind: 'vunion', group: g }));
        return [...groups, ...cards];
    }, [level, series, sets, filteredCards, inView, showVUnionGroups, catalog]);
    // Warm the first row of card images through the cache once per distinct view (set/filter/
    // search change), off the render path. Guarded so it fires at most once per view key.
    const prefetchedKey = useRef(null);
    const viewKey = `${level}:${setId ?? ''}:${q}:${JSON.stringify(selection)}`;
    useEffect(() => {
        if (!isCardLevel)
            return;
        if (prefetchedKey.current === viewKey)
            return;
        prefetchedKey.current = viewKey;
        const uris = filteredCards
            .slice(0, PREFETCH_COUNT)
            .map((c) => cardThumbUrl(c.id, 245))
            .filter(Boolean);
        if (uris.length > 0)
            Image.prefetch(uris, 'memory-disk').catch(() => { });
    }, [isCardLevel, viewKey, filteredCards]);
    // Navigation handlers clear facet selection so a stale filter can't hide the next
    // level's cards (avoids a set-state-in-effect on every level change).
    const clearSimilar = () => {
        setSimilarTo(null);
        setSimilarCards([]);
    };
    const openSeries = (id) => {
        clearFilters();
        clearSimilar();
        setSeriesId(id);
        setSetId(null);
    };
    const openSet = (id) => {
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
    const onChangeQuery = (text) => {
        // Only reset facets when entering/leaving search (empty ↔ non-empty), not on every
        // keystroke — so you can type a query, apply facet chips, then refine the text.
        if (cardQuery.trim().length === 0 !== (text.trim().length === 0))
            clearFilters();
        if (text.trim().length > 0)
            clearSimilar(); // typing a query leaves similar mode
        setCardQuery(text);
    };
    /** "Find similar" — embedding search on the data server, results shown in the grid. */
    const openSimilar = (card) => {
        setCardQuery('');
        setCardQueryDebounced('');
        clearFilters();
        setSimilarTo({ id: card.id, name: card.name });
        setSimilarCards([]);
        findSimilar(card.id, 24).then((hits) => {
            const cards = hits
                .map((h) => catalog.getCard(h.id))
                .filter((c) => Boolean(c));
            setSimilarCards(cards);
        });
    };
    /** "Find similar to all" — embedding search on the AVERAGE of the selected cards' vectors
     *  (find_similar_to_cards server-side). Results replace the grid, like openSimilar. */
    const openSimilarMany = (ids) => {
        setCardQuery('');
        setCardQueryDebounced('');
        clearFilters();
        setSimilarTo({ id: 'multi', name: `${ids.length} cards` });
        setSimilarCards([]);
        findSimilarToMany(ids, 24).then((hits) => {
            const cards = hits
                .map((h) => catalog.getCard(h.id))
                .filter((c) => Boolean(c));
            setSimilarCards(cards);
        });
    };
    // Multi-select is only meaningful when at least one batch action can run.
    const canMultiSelect = Boolean(onPickCards) || similarAvailable();
    // Read live at press time (modifierHeld is a ref → no re-render on key state change).
    const isSelecting = () => canMultiSelect && (multiSelectMode || (Platform.OS === 'web' && modifierHeld.current));
    /** Jump the drill-down to a card's set (clearing search/similar/filters first). */
    const jumpToSet = (card) => {
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
            if (!card)
                return;
            if (cmd.type === 'similar')
                openSimilar(card);
            else if (cmd.type === 'viewSet')
                jumpToSet(card);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalog]);
    /** Show every card by this card's illustrator — a search on the `artist:` field
     *  (quoted, since illustrator names have spaces). Sets both the raw and debounced
     *  query so results appear immediately, like jumpToSet/openSimilar. */
    const viewIllustrator = (card) => {
        const q = `artist:"${card.illustrator}"`;
        clearSimilar();
        clearFilters();
        setCardQuery(q);
        setCardQueryDebounced(q);
    };
    const toggleFacetValue = (key, value) => setSelection((prev) => {
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
    const openCard = onOpenCard ?? onPickCard ?? (() => { });
    /** The package-intrinsic actions for a card, bound to this browser's state. */
    const builtinsFor = (card) => ({
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
    const actionsFor = (card) => {
        const builtins = builtinsFor(card);
        if (cardActions)
            return resolveActions(cardActions(card, builtins), card);
        // Back-compat default: poke-michi's place/replace primary + the built-ins.
        const placeDefault = onPickCard
            ? [
                {
                    key: 'place',
                    kind: 'primary',
                    label: (c) => occupant && occupant.id !== c.id ? `Replace “${occupant.name}”` : 'Place in pocket',
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
        ].filter((a) => Boolean(a));
        return resolveActions(list, card);
    };
    const crumbs = [{ label: 'Series', onPress: seriesId ? goSeriesRoot : undefined }];
    if (currentSeries) {
        crumbs.push({ label: currentSeries.name, onPress: setId ? goSets : undefined });
    }
    if (currentSet)
        crumbs.push({ label: currentSet.name });
    const keyFor = (item) => item.kind === 'series'
        ? `ser-${item.series.id}`
        : item.kind === 'set'
            ? `set-${item.set.id}`
            : item.kind === 'vunion'
                ? `vu-${item.group.pieces.join('-')}`
                : `card-${item.card.id}`;
    const renderItem = ({ item }) => {
        if (item.kind === 'series') {
            const s = item.series;
            const meta = [seriesDateRange(s), `${s.cardCount.toLocaleString()} cards`, `${s.setIds.length} sets`]
                .filter(Boolean)
                .join(' · ');
            return (_jsx(TaxonomyTile, { styles: styles, title: s.name, meta: meta, coverUri: s.coverUri, width: taxTileW, onPress: () => openSeries(s.id) }));
        }
        if (item.kind === 'set') {
            const s = item.set;
            const meta = [s.code, `${s.cardCount.toLocaleString()} cards`, formatSetDate(s.releaseDate)]
                .filter(Boolean)
                .join(' · ');
            return (_jsx(TaxonomyTile, { styles: styles, title: s.name, meta: meta, coverUri: s.coverUri, width: taxTileW, onPress: () => openSet(s.id) }));
        }
        if (item.kind === 'vunion') {
            const g = item.group;
            return _jsx(VUnionTile, { styles: styles, group: g, width: tileW, onPress: () => onPickVUnion?.(g.pieces) });
        }
        const c = item.card;
        const value = priceOf(c.id);
        return (_jsx(CardTile, { styles: styles, card: c, width: tileW, selected: c.id === selectedCardId, 
            // In select mode (toggle, or web Ctrl/Shift) a tap toggles selection; else it opens
            // the single-card sheet.
            onPress: () => (isSelecting() ? toggleSelected(c.id) : setActionCard(c)), multiSelected: selectedIds.includes(c.id), 
            // value replaces the name line when sorting by value (keeps row geometry fixed)
            label: parsed.sort === 'value' && value > 0 ? formatUsd(value) : c.name, 
            // headline value under the name, only when pricing is surfaced
            value: analytics ? value : undefined, 
            // app-injected inline quick action (＋add / quick-place), if any
            quickAction: quickAction?.(c) }));
    };
    // Analytics is offered at the set level (over the set's cards) and the series level
    // (over every card in the series). `analyticsScope` is the target of the current toggle,
    // or null when analytics isn't applicable here.
    const analyticsScope = !analytics ? null : level === 'cards' && setId ? 'set' : level === 'sets' && seriesId ? 'series' : null;
    // Analytics replaces the card/set grid when the toggle is on.
    const analyticsView = analyticsScope != null && analyticsTab === 'analytics';
    // getItemLayout: for the grid, every `cols` items share a row of `rowHeight`; for the
    // single-column text levels each item is one row. Lets the list skip hundreds/thousands
    // of offscreen rows without measuring them.
    const getItemLayout = (_data, index) => {
        const row = Math.floor(index / cols);
        return { length: rowHeight, offset: rowHeight * row, index };
    };
    return (_jsxs(View, { style: styles.browser, onLayout: onLayout, children: [_jsxs(View, { style: styles.controls, children: [_jsx(Text, { style: styles.sectionLabel, children: "Cards \u00B7 1\u00D71" }), _jsxs(View, { style: styles.searchRow, children: [_jsx(TextInput, { value: cardQuery, onChangeText: onChangeQuery, placeholder: `Search ${catalog.cardCount.toLocaleString()} cards — ${QUERY_HINT}`, placeholderTextColor: theme.faint, autoCorrect: false, clearButtonMode: "while-editing", style: [styles.search, styles.searchFlex] }), _jsx(Pressable, { onPress: () => setHelpOpen((v) => !v), style: [styles.helpBtn, helpOpen && styles.helpBtnOn], hitSlop: 6, accessibilityLabel: "Search syntax help", children: _jsx(Text, { style: [styles.helpBtnText, helpOpen && styles.helpBtnTextOn], children: "?" }) })] }), helpOpen ? _jsx(SearchManual, { styles: styles, onClose: () => setHelpOpen(false) }) : null, occupant && similarAvailable() && similarTo?.id !== occupant.id ? (_jsx(Pressable, { style: styles.pocketSimilar, onPress: () => openSimilar(occupant), children: _jsxs(Text, { style: styles.pocketSimilarText, numberOfLines: 1, children: ["\u2248 Find similar to \u201C", occupant.name, "\u201D (in this pocket)"] }) })) : null, searching ? (_jsxs(View, { style: styles.metaRow, children: [_jsxs(Text, { style: styles.meta, numberOfLines: 1, children: [filteredCards.length === viewCards.length
                                        ? `${viewCards.length} result${viewCards.length === 1 ? '' : 's'}`
                                        : `${filteredCards.length} of ${viewCards.length}`, viewCards.length >= SEARCH_LIMIT ? '+' : '', " \u00B7 ", describeQuery(parsed, viewCards)] }), _jsx(Pressable, { onPress: () => onChangeQuery(''), hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })] })) : similarTo ? (_jsxs(View, { style: styles.metaRow, children: [_jsx(Text, { style: styles.meta, numberOfLines: 1, children: similarCards.length > 0
                                    ? `${filteredCards.length} cards similar to “${similarTo.name}”`
                                    : `Finding cards similar to “${similarTo.name}”…` }), _jsx(Pressable, { onPress: clearSimilar, hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })] })) : seriesId ? (_jsx(Breadcrumb, { styles: styles, crumbs: crumbs })) : (_jsxs(Text, { style: styles.meta, children: [series.length, " series"] })), analyticsScope ? (_jsx(View, { style: styles.tabRow, children: ['cards', 'analytics'].map((t) => {
                            const on = t === analyticsTab;
                            const label = t === 'analytics' ? 'Analytics' : analyticsScope === 'series' ? 'Sets' : 'Cards';
                            return (_jsx(Pressable, { onPress: () => setAnalyticsTab(t), style: [styles.tab, on && styles.tabOn], children: _jsx(Text, { style: [styles.tabText, on && styles.tabTextOn], children: label }) }, t));
                        }) })) : null, isCardLevel && facetOptions.length > 0 && !analyticsView ? (_jsx(FacetBar, { styles: styles, options: facetOptions, selection: selection, activeCount: activeFilterCount, open: filtersOpen, onToggleOpen: () => setFiltersOpen((v) => !v), onToggleValue: toggleFacetValue, onClear: clearFilters })) : null, isCardLevel && canMultiSelect && !analyticsView ? (_jsx(View, { style: styles.selectRow, children: multiSelectMode || selectedIds.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Text, { style: styles.selectMeta, numberOfLines: 1, children: [selectedIds.length, " selected", selectedIds.length < 2 ? ' · tap 2+' : ''] }), _jsx(Pressable, { disabled: selectedIds.length < 2, onPress: () => setMultiOpen(true), style: [styles.selectBtn, selectedIds.length < 2 && styles.selectBtnOff], children: _jsx(Text, { style: styles.selectBtnText, children: "Continue \u2192" }) }), _jsx(Pressable, { onPress: () => {
                                        setMultiSelectMode(false);
                                        clearSelection();
                                    }, hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Cancel" }) })] })) : (_jsx(Pressable, { onPress: () => setMultiSelectMode(true), style: styles.selectToggle, children: _jsx(Text, { style: styles.selectToggleText, children: "\u2295 Select multiple" }) })) })) : null] }), analyticsView ? (_jsx(ScrollView, { style: styles.list, contentContainerStyle: styles.analyticsContent, children: analyticsScope === 'set' && setId ? (_jsx(SetAnalytics, { catalog: catalog, setId: setId, onOpenCard: openCard, theme: theme })) : analyticsScope === 'series' && seriesId ? (_jsx(SeriesAnalytics, { catalog: catalog, seriesId: seriesId, onOpenCard: openCard, theme: theme })) : null })) : (_jsx(FlatList
            // Remount when the level or column count changes so numColumns/getItemLayout stay
            // consistent (FlatList can't change numColumns in place).
            , { style: styles.list, data: data, keyExtractor: keyFor, renderItem: renderItem, numColumns: cols, columnWrapperStyle: cols > 1 ? styles.column : undefined, contentContainerStyle: styles.listContent, getItemLayout: getItemLayout, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag", initialNumToRender: cols * 6, maxToRenderPerBatch: cols * 4, windowSize: 9, removeClippedSubviews: true, ListEmptyComponent: _jsx(Text, { style: styles.empty, children: searching
                        ? `No cards match “${q}”.`
                        : level === 'similar'
                            ? similarCards.length === 0 && similarTo
                                ? 'Searching…'
                                : 'No similar cards found.'
                            : level === 'cards'
                                ? 'No cards in this set.'
                                : 'Nothing here.' }), ListFooterComponent: _jsx(View, { style: styles.footer, children: footer }) }, `lvl-${level}-c${cols}`)), actionCard ? (_jsx(CardActionModal, { card: actionCard, actions: actionsFor(actionCard), value: priceOf(actionCard.id), onClose: () => setActionCard(null), theme: theme })) : null, multiOpen ? (_jsx(MultiCardActionModal, { cards: selectedIds
                    .map((id) => catalog.getCard(id))
                    .filter((c) => Boolean(c)), onAddAll: onPickCards ? () => onPickCards(selectedIds) : undefined, onFindSimilarAll: similarAvailable() ? () => openSimilarMany(selectedIds) : undefined, onClose: () => {
                    setMultiOpen(false);
                    setMultiSelectMode(false);
                    clearSelection();
                }, theme: theme })) : null] }));
}
// ---- compact taxonomy rows + card tile + breadcrumb ----------------------------
/**
 * A series/set tile for the multi-column taxonomy grid: a logo (or the initial when michi
 * has no cover, which is most), the name, and a meta line. Fixed height so getItemLayout can
 * skip offscreen rows.
 */
function TaxonomyTile({ styles, title, meta, coverUri, width, onPress, }) {
    return (_jsxs(Pressable, { style: [styles.taxTile, { width }], onPress: onPress, children: [_jsx(View, { style: styles.taxLogoWrap, children: coverUri ? (_jsx(Image, { source: { uri: coverUri }, style: styles.taxLogo, contentFit: "contain", transition: 100 })) : (_jsx(Text, { style: styles.taxInitial, children: title.trim().charAt(0).toUpperCase() })) }), _jsx(Text, { style: styles.taxTitle, numberOfLines: 2, children: title }), meta ? (_jsx(Text, { style: styles.taxMeta, numberOfLines: 2, children: meta })) : null] }));
}
/**
 * A single dense catalog-card tile. Width is driven by the measured grid so tiles stay
 * small. Cards with no local image show a neutral fallback, never a crash. Images use the
 * same memory-disk cache + recyclingKey pattern as BinderGrid.
 */
function CardTile({ styles, card, width, selected, multiSelected, onPress, label, value, quickAction, }) {
    // Grid tier: the 245px webp (~20KB), resolved by id via the image manifest.
    const uri = cardThumbUrl(card.id, 245);
    return (_jsxs(Pressable, { style: [styles.cardTile, { width }, selected && styles.cardTileSelected, multiSelected && styles.cardTileMulti], onPress: onPress, children: [_jsxs(View, { style: styles.cardImageWrap, children: [uri ? (_jsx(Image, { source: { uri }, style: styles.cardImage, contentFit: "contain", cachePolicy: "memory-disk", recyclingKey: card.id, transition: 100 })) : (_jsx(View, { style: styles.cardImageFallback, children: _jsx(Text, { style: styles.cardImageFallbackText, children: "no image" }) })), multiSelected ? (_jsx(View, { style: styles.cardCheck, children: _jsx(Text, { style: styles.cardCheckText, children: "\u2713" }) })) : null, quickAction ? (_jsx(Pressable, { style: styles.cardQuick, hitSlop: 6, onPress: () => quickAction.onPress(card), accessibilityLabel: typeof quickAction.label === 'string' ? quickAction.label : 'Quick action', children: _jsx(Text, { style: styles.cardQuickText, numberOfLines: 1, children: typeof quickAction.label === 'function' ? quickAction.label(card) : quickAction.label }) })) : null] }), _jsx(Text, { style: styles.cardName, numberOfLines: 1, children: label ?? card.name }), value != null && value > 0 ? (_jsx(Text, { style: styles.cardValue, numberOfLines: 1, children: formatUsd(value) })) : null] }));
}
/**
 * A V-UNION group tile (Size=V-UNION): the assembled art (its top-left piece thumb) with a
 * V-UNION badge and label. Tapping places the whole 2×2 (onPress → onPickVUnion(pieces)).
 */
function VUnionTile({ styles, group, width, onPress, }) {
    const uri = cardThumbUrl(group.pieces[0], 245);
    return (_jsxs(Pressable, { style: [styles.cardTile, { width }], onPress: onPress, children: [_jsxs(View, { style: styles.cardImageWrap, children: [uri ? (_jsx(Image, { source: { uri }, style: styles.cardImage, contentFit: "contain", cachePolicy: "memory-disk", recyclingKey: group.pieces[0], transition: 100 })) : (_jsx(View, { style: styles.cardImageFallback, children: _jsx(Text, { style: styles.cardImageFallbackText, children: "V-UNION" }) })), _jsx(View, { style: styles.vunionTag, children: _jsx(Text, { style: styles.vunionTagText, children: "V-UNION" }) })] }), _jsx(Text, { style: styles.cardName, numberOfLines: 1, children: group.label })] }));
}
/** The "?" panel: the search grammar manual (content lives in browse/query.ts,
 *  shared with the sibling app; this just renders it compactly). */
function SearchManual({ styles, onClose }) {
    return (_jsxs(View, { style: styles.manual, children: [_jsxs(View, { style: styles.manualHeader, children: [_jsx(Text, { style: styles.manualTitle, children: "Search syntax" }), _jsx(Pressable, { onPress: onClose, hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Close" }) })] }), QUERY_MANUAL.map((section) => (_jsxs(View, { style: styles.manualSection, children: [_jsx(Text, { style: styles.manualSectionTitle, children: section.title }), section.rows.map(([code, description]) => (_jsxs(View, { style: styles.manualRow, children: [_jsx(Text, { style: styles.manualCode, children: code }), _jsx(Text, { style: styles.manualDesc, children: description })] }, code)))] }, section.title)))] }));
}
/** Series › Set path; tap an ancestor to drill up. */
function Breadcrumb({ styles, crumbs }) {
    return (_jsx(View, { style: styles.bcBar, children: crumbs.map((c, i) => (_jsxs(View, { style: styles.bcItem, children: [i > 0 ? _jsx(Text, { style: styles.bcSep, children: "\u203A" }) : null, _jsx(Text, { onPress: c.onPress, style: [styles.bcCrumb, c.onPress ? styles.bcLink : styles.bcCurrent], numberOfLines: 1, children: c.label })] }, `${c.label}-${i}`))) }));
}
/**
 * Compact, expandable filter panel. Collapsed it's a single row (a Filters toggle + active
 * count + Clear); expanded it reveals one horizontal multi-select chip row per populated
 * facet — so it never eats the card viewport.
 */
function FacetBar({ styles, options, selection, activeCount, open, onToggleOpen, onToggleValue, onClear, }) {
    return (_jsxs(View, { style: styles.facetBar, children: [_jsxs(View, { style: styles.facetHeader, children: [_jsx(Pressable, { onPress: onToggleOpen, style: [styles.facetToggle, activeCount > 0 && styles.facetToggleOn], children: _jsxs(Text, { style: [styles.facetToggleText, activeCount > 0 && styles.facetToggleTextOn], children: [open ? '▾ Filters' : '▸ Filters', activeCount > 0 ? ` · ${activeCount}` : ''] }) }), activeCount > 0 ? (_jsx(Pressable, { onPress: onClear, hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })) : null] }), open ? (_jsx(View, { style: styles.facetRows, children: options.map(({ facet, values }) => (_jsxs(View, { style: styles.facetGroup, children: [_jsx(Text, { style: styles.facetLabel, children: facet.label }), _jsx(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.chipRow, keyboardShouldPersistTaps: "handled", children: values.map((v) => {
                                const on = (selection[facet.key] ?? []).includes(v);
                                return (_jsx(Pressable, { onPress: () => onToggleValue(facet.key, v), style: [styles.chip, on && styles.chipOn], children: _jsx(Text, { style: [styles.chipText, on && styles.chipTextOn], numberOfLines: 1, children: v }) }, v));
                            }) })] }, facet.key))) })) : null] }));
}
function makeStyles(t, taxTileHeight) {
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
