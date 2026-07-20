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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, } from 'react-native';
import { describeQuery, parseQuery, QUERY_HINT, QUERY_MANUAL, runQuery, sortCards, } from './query';
import { CARD_GRID_GAP, cardGridColumns, cardTierFor, cardTileWidthFor, } from './cardSize';
import { browseState, subscribeBrowseCommand } from './state';
import { CardActionModal, MultiCardActionModal } from './CardActionModal';
import { SeriesAnalytics, SetAnalytics } from './analytics';
import { resolveActions, } from './actions';
import { formatSetDate, seriesDateRange, useCatalogStatus, } from './catalog';
import { cardThumbUrl } from './config';
import { useImageManifest } from './images';
import { formatUsd, usePriceSummary } from './prices';
import { findSimilarWeighted, similarAvailable } from './similar';
import { fetchCardsByIds, fetchSetCards, searchCards, searchFacets, serverSearchAvailable, } from './search';
import { useTaxonomy } from './taxonomy';
import { resolveTheme, tileShadow } from './theme';
/** Rows of cards revealed per "page" — the grid renders this many, then grows on scroll
 *  (infinite scroll). Full result sets aren't capped; the FlatList just virtualizes them. */
const PAGE_SIZE = 90;
/** Dense grid tuning: aim each card tile at ~this width, then pack as many columns as fit. */
const TARGET_TILE_W = 72;
const GRID_GAP = CARD_GRID_GAP;
const CARD_ASPECT = 88 / 63; // height / width of a standard portrait card
/** Fixed extra height under each card thumb: name line + its margin + inter-row gap. */
const CARD_LABEL_H = 14;
const ROW_GAP = 6;
/** Series/set tiles: target width (packs into 3–5 columns by page width) + a fixed tile height
 *  (must match the `taxTile` style so getItemLayout can skip offscreen rows). */
const TARGET_TAX_TILE_W = 250;
const TAX_TILE_H = 176;
/** How many of the first cards to warm through the image cache when a view changes. */
const PREFETCH_COUNT = 12;
/** Distinct, alphabetically-sorted values pulled off `cards` via `pick`. */
function distinctSorted(cards, pick) {
    return [...new Set(cards.flatMap(pick).filter(Boolean))].sort();
}
/** Gapless HP buckets (from the corpus HP distribution) — categorical chips for the HP facet. */
const HP_BUCKETS = [
    { label: '≤ 60', max: 60 },
    { label: '70–100', max: 100 },
    { label: '110–150', max: 150 },
    { label: '160–200', max: 200 },
    { label: '210+', max: Infinity },
];
function hpBucket(hp) {
    return (HP_BUCKETS.find((b) => hp <= b.max) ?? HP_BUCKETS[HP_BUCKETS.length - 1]).label;
}
/** Evolution-stage chip labels, indexed by the 1-indexed evolutionStage (Basic = 1). */
const EVO_LABELS = ['Basic', 'Stage 1', 'Stage 2', 'Stage 3+'];
function evoLabel(stage) {
    return EVO_LABELS[Math.min(stage - 1, EVO_LABELS.length - 1)] ?? EVO_LABELS[0];
}
/** Keep facet chips in a fixed order (not alphabetized), dropping labels absent from `cards`. */
function orderedPresent(labels, cards, labelOf) {
    const present = new Set(cards.map(labelOf).filter((v) => v != null));
    return labels.filter((l) => present.has(l));
}
/** UI sort control: the fields the sort chips offer + each field's natural default direction. */
const SORT_OPTIONS = [
    { field: 'relevance', label: 'Relevance' },
    { field: 'value', label: 'Value' },
    { field: 'date', label: 'Date' },
    { field: 'hp', label: 'HP' },
    { field: 'stage', label: 'Evolution' },
    { field: 'name', label: 'Name' },
];
/** UI size control: the tile-size steps offered by the Size chips. */
const SIZE_OPTIONS = [
    { size: 'S', label: 'S' },
    { size: 'M', label: 'M' },
    { size: 'L', label: 'L' },
];
const SORT_DEFAULT_DIR = {
    relevance: 'desc',
    value: 'desc',
    date: 'desc',
    name: 'asc',
    hp: 'desc',
    stage: 'asc',
};
/** Display order for cold-mode facet values (server returns them unordered). */
function orderFacetValues(key, values) {
    const uniq = [...new Set(values)];
    if (key === 'hp') {
        const order = HP_BUCKETS.map((b) => b.label);
        return uniq.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }
    if (key === 'evolution')
        return uniq.sort((a, b) => EVO_LABELS.indexOf(a) - EVO_LABELS.indexOf(b));
    if (key === 'size')
        return uniq.sort((a, b) => (a === 'Standard' ? -1 : b === 'Standard' ? 1 : 0));
    if (key === 'year')
        return uniq.sort().reverse(); // newest first, like the warm facet
    return uniq.sort();
}
/** tqdm-style one-liner for the load badge: "☁ Server search · full browse 45% · 3.2/8.8 MB · 4s left". */
function loadLabel(s, coldSearch) {
    // No load in flight (e.g. guests: the app never requests the catalog) — server search IS the
    // mode, don't imply a download is coming.
    if (s.status === 'idle')
        return coldSearch ? '☁ Server search — instant' : 'Loading cards…';
    if (s.status === 'error')
        return coldSearch ? '☁ Server search — instant' : 'Catalog failed to load — pull to retry';
    const prefix = coldSearch ? '☁ Server search · full browse' : 'Loading cards';
    const pct = Math.round(s.progress * 100);
    const mb = (n) => (n / 1e6).toFixed(1);
    const bytes = s.status === 'downloading' && s.receivedBytes > 0
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
        // Printing language (English / Japanese). Only surfaces once the catalog
        // actually holds both languages — a single-language catalog yields [] from
        // `available` and the facet is skipped automatically (see the seam note).
        key: 'language',
        label: 'Language',
        valuesOf: (c) => [c.language === 'ja' ? 'Japanese' : 'English'],
        available: (cards) => {
            const vals = distinctSorted(cards, (c) => [c.language === 'ja' ? 'Japanese' : 'English']);
            return vals.length > 1 ? vals : [];
        },
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
    {
        // Printed HP, bucketed into categorical chips (the query grammar's hp>N is finer-grained).
        key: 'hp',
        label: 'HP',
        valuesOf: (c) => (c.hp == null ? [] : [hpBucket(c.hp)]),
        available: (cards) => orderedPresent(HP_BUCKETS.map((b) => b.label), cards, (c) => (c.hp == null ? null : hpBucket(c.hp))),
    },
    {
        // Evolution stage, driven by evolution_stage_index (Basic / Stage 1 / Stage 2), NOT the TCG
        // `stage` string. The grammar's stage>N filters this same 1-indexed value.
        key: 'evolution',
        label: 'Evolution',
        valuesOf: (c) => (c.evolutionStage > 0 ? [evoLabel(c.evolutionStage)] : []),
        available: (cards) => orderedPresent(EVO_LABELS, cards, (c) => (c.evolutionStage > 0 ? evoLabel(c.evolutionStage) : null)),
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
export function CatalogBrowser({ catalog, selectedCardId, onPickCard, onPickVUnion, onPickCards, pickCardsLabel, cardActions, quickAction, onOpenCard, footer, analytics, analyticsLocked, theme: themeProp, cardTileWidth = TARGET_TILE_W, taxTileHeight = TAX_TILE_H, initialSimilar, languages, cardSize: cardSizeProp, onCardSizeChange, onColorSearch, }) {
    const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
    const styles = useMemo(() => makeStyles(theme, taxTileHeight), [theme, taxTileHeight]);
    // Hydrate the content-hashed image manifest and repaint tiles when it lands —
    // card images resolve by id (cardThumbUrl), not from URLs in the catalog.
    useImageManifest();
    // Catalog load phase — drives the search-source badge (on-device vs, later, server search).
    const catalogStatus = useCatalogStatus();
    // Upstream language constraint → a stable Set (null = unconstrained). Keyed by the sorted codes
    // so an inline array prop doesn't thrash memo identity. `langOk` gates the warm/local card lists;
    // the cold server path is constrained server-side via the `languages` arg to the RPC calls.
    const langSet = useMemo(() => (languages && languages.length ? new Set(languages) : null), 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [languages?.join(',')]);
    const langOk = (c) => !langSet || langSet.has(c.language);
    // Stable array form of the same constraint for the cold server RPCs (undefined = unconstrained).
    const langArg = useMemo(() => (langSet ? [...langSet] : undefined), [langSet]);
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
    // UI sort control: null → follow the search box's `sort:` (else relevance).
    const [sortSel, setSortSel] = useState(browseState.sortSel);
    // Card-tile size step (scales `cardTileWidth`). Seeded from the app's global `cardSize` prop when
    // given, else the session-sticky browseState. The toolbar toggle overrides locally; when the
    // global prop changes the browser follows it (global-default + local-override).
    const [cardSize, setCardSize] = useState(cardSizeProp ?? browseState.cardSize);
    useEffect(() => {
        if (cardSizeProp)
            setCardSize(cardSizeProp);
    }, [cardSizeProp]);
    // Local toggle: apply + lift to the app's global store (if wired).
    const pickCardSize = (s) => {
        setCardSize(s);
        onCardSizeChange?.(s);
    };
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    // "Find similar" mode: results of the data server's embedding RPC for one card.
    const [similarTo, setSimilarTo] = useState(browseState.similarTo);
    const [similarCards, setSimilarCards] = useState(browseState.similarCards);
    // The ongoing similarity session (seed + every more/less refinement) — see similar.ts.
    const [similarSteps, setSimilarSteps] = useState(browseState.similarSteps);
    // True only while a similarity request is actually in flight. Without this, an empty result
    // (RPC failure/timeout fails soft to []) was indistinguishable from "still searching" and the
    // grid showed "Searching…" forever — the user's only way out was a full page refresh.
    const [similarBusy, setSimilarBusy] = useState(false);
    const similarReq = useRef(0);
    // Cold path (catalog not loaded yet): text search runs against the server's search_cards RPC.
    // We accumulate pages, guarding against out-of-order responses with a monotonic request token.
    const warm = Boolean(catalog);
    const coldSearch = !warm && serverSearchAvailable();
    const [serverCards, setServerCards] = useState([]);
    const [serverPrice, setServerPrice] = useState({});
    const [serverTotal, setServerTotal] = useState(0);
    const [serverLoading, setServerLoading] = useState(false);
    // Cold facet bar: facet key → values for the current query (search_facets, exclude-self).
    const [serverFacets, setServerFacets] = useState({});
    const serverOffset = useRef(0);
    const serverToken = useRef(0);
    // Cold drill-down: the tiny public taxonomy stands in for the catalog's series/sets, and a
    // set's cards are fetched from the server on drill (cached per set in the search module).
    const taxonomy = useTaxonomy(coldSearch);
    const tax = catalog ?? taxonomy;
    const [coldSetCards, setColdSetCards] = useState([]);
    const [coldSetLoading, setColdSetLoading] = useState(false);
    useEffect(() => {
        if (catalog || !setId || !coldSearch) {
            setColdSetCards([]);
            return;
        }
        let stale = false;
        setColdSetLoading(true);
        fetchSetCards(setId, langArg).then((cards) => {
            if (stale)
                return;
            setColdSetCards(cards);
            setColdSetLoading(false);
        });
        return () => {
            stale = true;
        };
    }, [catalog, coldSearch, setId, langArg]);
    /** Resolve ids to cards: catalog when warm, a server fetch when cold. */
    const resolveIds = useCallback(async (ids) => {
        if (catalog) {
            return ids.map((id) => catalog.getCard(id)).filter((c) => Boolean(c));
        }
        return fetchCardsByIds(ids);
    }, [catalog]);
    // Cold-resolved cards by id (occupant, similar-source thumbs, command targets) — filled by
    // the effects below so synchronous lookups work without the catalog.
    const [coldCards, setColdCards] = useState({});
    /** Best-effort synchronous lookup for thumbs/sheets: catalog, cold cache, or the current view. */
    const findCard = (id) => catalog?.getCard(id) ?? coldCards[id] ?? viewCardsRef.current.find((c) => c.id === id);
    const viewCardsRef = useRef([]);
    // Cold: resolve the pocket occupant + any similar-source ids that aren't otherwise findable,
    // so the "≈ similar to what's here" shortcut and the source-thumb sheets work for guests.
    useEffect(() => {
        if (catalog)
            return;
        const wanted = [...(selectedCardId ? [selectedCardId] : []), ...(similarTo?.ids ?? [])];
        const missing = wanted.filter((id) => !coldCards[id]);
        if (missing.length === 0)
            return;
        let stale = false;
        fetchCardsByIds(missing).then((cards) => {
            if (stale || cards.length === 0)
                return;
            setColdCards((prev) => ({ ...prev, ...Object.fromEntries(cards.map((c) => [c.id, c])) }));
        });
        return () => {
            stale = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalog, selectedCardId, similarTo]);
    // Write every change back so the next mount resumes here.
    useEffect(() => {
        Object.assign(browseState, {
            cardQuery,
            seriesId,
            setId,
            selection,
            sortSel,
            cardSize,
            similarTo,
            similarCards,
            similarSteps,
        });
    }, [cardQuery, seriesId, setId, selection, sortSel, cardSize, similarTo, similarCards, similarSteps]);
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
    // Warm: the price summary. Cold: the `cur` the RPC returned with each hit.
    const priceSummary = usePriceSummary();
    // The public price summary serves both tiers; cold search hits also carry their own `cur`.
    const priceOf = (id) => priceSummary?.[id]?.cur ?? serverPrice[id] ?? 0;
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
    // Cold (no catalog): search + similar are server-backed, and the drill-down runs off the
    // tiny public taxonomy (per-set cards fetched on drill). 'coldidle' only while the taxonomy
    // itself is still loading / unavailable.
    const level = searching
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
    // Series + sets are language-tagged (explicit field, else derived) — constrain the taxonomy
    // drill-down to the allowed language(s), same as the card lists, so an EN-only browser never
    // shows JP series/set tiles.
    const series = useMemo(() => (tax?.listSeries() ?? []).filter((s) => !langSet || langSet.has(s.language)), [tax, langSet]);
    const sets = useMemo(() => (tax && seriesId ? tax.listSets(seriesId) : []).filter((s) => !langSet || langSet.has(s.language)), [tax, seriesId, langSet]);
    // The parsed search-box query (grammar: words, key:value fields, price bounds, sort).
    const parsed = useMemo(() => parseQuery(q), [q]);
    // Effective sort: the UI sort control wins; otherwise the search box's `sort:` (or relevance).
    const effSort = useMemo(() => {
        if (sortSel)
            return sortSel;
        if (parsed.sort !== 'relevance')
            return { field: parsed.sort, dir: parsed.sortDir };
        return { field: 'relevance', dir: 'desc' };
    }, [sortSel, parsed.sort, parsed.sortDir]);
    // The query actually run/described/labelled, with the effective sort folded in.
    const effParsed = useMemo(() => ({ ...parsed, sort: effSort.field, sortDir: effSort.dir }), [parsed, effSort]);
    // Cards currently in view, before facet filtering: ranked full-corpus search results
    // (bare words match name/artist/set/series/rarity/type/stage — name hits rank first),
    // similar-mode results, or the set's cards.
    const viewCards = useMemo(() => {
        // Cold search: the accumulated server-search pages (already language-constrained server-side).
        if (!catalog && searching)
            return serverCards;
        if (catalog && searching)
            return runQuery(catalog.listAll().filter(langOk), effParsed, priceOf, Infinity);
        // Set cards / similar results (warm from the catalog, cold from the per-set fetch): keep
        // their natural order (collector number / best-match) until the UI sort control asks for
        // something else, then re-sort by the chosen field. The language bound applies to every local
        // list so facet options + counts stay consistent with what's shown.
        const rawBase = similarTo ? similarCards : setId ? (catalog ? catalog.listCards(setId) : coldSetCards) : [];
        const base = langSet ? rawBase.filter(langOk) : rawBase;
        if (effSort.field === 'relevance' || base.length === 0)
            return base;
        return sortCards(base, effParsed, priceOf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalog, searching, serverCards, coldSetCards, effParsed, effSort.field, setId, similarTo, similarCards, priceSummary, langSet]);
    viewCardsRef.current = viewCards;
    // Cold search: (re)fetch page 0 when the query/sort/facet selection changes; the token guard
    // drops stale responses. A page's `total` + prices land in state for the header/tiles.
    const fetchServerPage = useCallback(async (offset, replace) => {
        const token = ++serverToken.current;
        setServerLoading(true);
        const page = await searchCards(effParsed, {
            limit: PAGE_SIZE,
            offset,
            facets: selection,
            languages: langArg,
        });
        if (serverToken.current !== token)
            return; // a newer request superseded this one
        serverOffset.current = offset + page.cards.length;
        setServerTotal(page.total);
        setServerPrice((prev) => (replace ? page.priceById : { ...prev, ...page.priceById }));
        setServerCards((prev) => (replace ? page.cards : [...prev, ...page.cards]));
        setServerLoading(false);
    }, [effParsed, selection, langArg]);
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
        searchFacets(effParsed, selection, langArg).then((f) => {
            if (!stale)
                setServerFacets(f);
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
    const hasVUnionInView = useMemo(() => (catalog?.vunionGroups() ?? []).some((g) => g.pieces.some((pid) => inView.has(pid))), [catalog, inView]);
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
        if (!isCardLevel)
            return [];
        if (!localView) {
            if (!coldSearch)
                return [];
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
    const filteredCards = useMemo(() => (localView ? applyFacets(viewCards, selection) : viewCards), [localView, viewCards, selection]);
    const activeFilterCount = useMemo(() => Object.values(selection).reduce((n, vals) => n + vals.length, 0), [selection]);
    // Dense grid geometry from the measured width. Falls back to a sane default pre-layout.
    const { numColumns, tileW, taxCols, taxTileW } = useMemo(() => {
        if (containerWidth <= 0) {
            return { numColumns: 4, tileW: cardTileWidth, taxCols: 2, taxTileW: TARGET_TAX_TILE_W };
        }
        // Card grid columns/width for the Size step — the shared kit norm (see cardSize.ts).
        const cCols = cardGridColumns(containerWidth, cardTileWidth, cardSize, GRID_GAP);
        const cW = cardTileWidthFor(containerWidth, cCols, GRID_GAP);
        // Series/set tiles: 2–4 wide columns (bigger cover art than the card tiles).
        const tCols = Math.max(2, Math.min(4, Math.floor((containerWidth + GRID_GAP) / (TARGET_TAX_TILE_W + GRID_GAP))));
        const tW = Math.floor((containerWidth - GRID_GAP * (tCols - 1)) / tCols);
        return { numColumns: cCols, tileW: cW, taxCols: tCols, taxTileW: tW };
    }, [containerWidth, cardTileWidth, cardSize]);
    const cols = isCardLevel ? numColumns : taxCols;
    const cardRowHeight = Math.round(tileW * CARD_ASPECT + CARD_LABEL_H + ROW_GAP);
    const rowHeight = isCardLevel ? cardRowHeight : taxTileHeight + ROW_GAP;
    // Size=V-UNION surfaces assembled group tiles (no per-card signal exists for them). Shown
    // ahead of any plain cards the rest of the Size selection matches (Standard/Jumbo).
    const showVUnionGroups = isCardLevel && catalog && (selection.size ?? []).includes(VUNION_SIZE);
    const data = useMemo(() => {
        if (level === 'series')
            return series.map((s) => ({ kind: 'series', series: s }));
        if (level === 'sets')
            return sets.map((s) => ({ kind: 'set', set: s }));
        const cards = filteredCards.map((c) => ({ kind: 'card', card: c }));
        if (!showVUnionGroups || !catalog)
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
    // Infinite scroll: reveal a page of rows, grow on end-reached. Reset to the top when the
    // view (level/search/filters) or the sort changes.
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [viewKey, effSort.field, effSort.dir]);
    // Local views paginate client-side (slice a growing window). Cold SEARCH paginates on the
    // server, so show every page fetched so far.
    const visibleData = useMemo(() => (localView ? data.slice(0, visibleCount) : data), [localView, data, visibleCount]);
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
        setSimilarSteps([]);
    };
    // "· refined +2 −1" summary for the similar-mode header (counts of more/less steps).
    const moreCount = similarSteps.filter((st) => st.kind === 'more').length;
    const lessCount = similarSteps.filter((st) => st.kind === 'less').length;
    const refineNote = moreCount || lessCount
        ? ` · refined${moreCount ? ` +${moreCount}` : ''}${lessCount ? ` −${lessCount}` : ''}`
        : '';
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
    /** Run (or re-run) the similarity session: fetch, resolve, publish — guarded by a monotonic
     *  token so a slow/stale response can't clobber a newer search, and ALWAYS settling
     *  `similarBusy` so the UI can tell "searching" from "found nothing / failed" (and offer
     *  Retry instead of an eternal spinner). One seed step is the plain find-similar case —
     *  the weighted RPC with a single weight-1.0 group ranks identically. */
    const runSimilar = (steps) => {
        const token = ++similarReq.current;
        setSimilarBusy(true);
        findSimilarWeighted(steps, 24)
            .then((hits) => resolveIds(hits.map((h) => h.id)))
            .catch(() => [])
            .then((cards) => {
            if (similarReq.current !== token)
                return; // superseded by a newer search
            setSimilarCards(cards);
            setSimilarBusy(false);
        });
    };
    /** "Find similar" — embedding search on the data server, results shown in the grid. */
    const openSimilar = (card) => {
        setCardQuery('');
        setCardQueryDebounced('');
        clearFilters();
        setSimilarTo({ ids: [card.id], name: card.name });
        setSimilarCards([]);
        const steps = [{ kind: 'seed', ids: [card.id] }];
        setSimilarSteps(steps);
        runSimilar(steps);
    };
    /** "Find similar to all" — embedding search on the AVERAGE of the selected cards' vectors.
     *  Results replace the grid, like openSimilar. */
    const openSimilarMany = (ids) => {
        setCardQuery('');
        setCardQueryDebounced('');
        clearFilters();
        setSimilarTo({ ids: [...ids], name: `${ids.length} cards` });
        setSimilarCards([]);
        const steps = [{ kind: 'seed', ids: [...ids] }];
        setSimilarSteps(steps);
        runSimilar(steps);
    };
    /** Display an EXACT pre-ranked id list as a result set (e.g. a color search) — resolved to cards
     *  (warm/cold) and shown in the grid with facets / multi-select / actions / sort, but no embedding
     *  refine (`injected`). The order of `ids` is the ranking; keep it (relevance sort = input order). */
    const openCards = (ids, label) => {
        setCardQuery('');
        setCardQueryDebounced('');
        clearFilters();
        setSimilarSteps([]);
        setSimilarTo({ ids: [], name: label, injected: true });
        setSimilarCards([]);
        const token = ++similarReq.current;
        setSimilarBusy(true);
        resolveIds(ids).then((cards) => {
            if (similarReq.current !== token)
                return;
            setSimilarCards(cards);
            setSimilarBusy(false);
        });
    };
    /** "More / less like this" — extend the ONGOING similarity session and re-rank against the
     *  weighted (Rocchio) history: seed 1.0, each more-group +0.8, each less-group −0.5, split
     *  across group members (see similar.ts refineWeights). Seed chips stay; the grid re-ranks. */
    const refineSimilar = (kind, ids) => {
        const steps = [...similarSteps, { kind, ids }];
        setSimilarSteps(steps);
        setSimilarCards([]);
        runSimilar(steps);
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
            if (cmd.type === 'similarMany') {
                openSimilarMany(cmd.cardIds);
                return;
            }
            if (cmd.type === 'showCards') {
                openCards(cmd.ids, cmd.label);
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
            // Resolve the target card (catalog when warm, server fetch when cold) and run —
            // so the commands work for guests too.
            resolveIds([cmd.cardId]).then(([card]) => {
                if (!card)
                    return;
                if (cmd.type === 'similar')
                    openSimilar(card);
                else
                    jumpToSet(card);
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [catalog]);
    // One-shot "find similar to all" seed from a host (the binder picker): run the multi-card
    // search on mount, bypassing the broadcast command bus so a second mounted browser can't
    // steal it. Ref-guarded → applied once per distinct seed array (a fresh open passes a new ref).
    const appliedSimilarRef = useRef(null);
    useEffect(() => {
        if (!initialSimilar || initialSimilar.length === 0)
            return;
        if (appliedSimilarRef.current === initialSimilar)
            return;
        appliedSimilarRef.current = initialSimilar;
        openSimilarMany(initialSimilar);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSimilar]);
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
    // Sort chips: tap a field to sort by it; tap the active field again (or the ↑/↓ button) to
    // flip its direction. Relevance has no direction.
    const pickSort = (field) => {
        if (field === effSort.field && field !== 'relevance') {
            setSortSel({ field, dir: effSort.dir === 'asc' ? 'desc' : 'asc' });
        }
        else {
            setSortSel({ field, dir: field === 'relevance' ? 'desc' : SORT_DEFAULT_DIR[field] });
        }
    };
    const toggleSortDir = () => setSortSel({ field: effSort.field, dir: effSort.dir === 'asc' ? 'desc' : 'asc' });
    const currentSeries = tax && seriesId ? tax.getSeries(seriesId) : undefined;
    const currentSet = tax && setId ? tax.getSet(setId) : undefined;
    // The card already in the pocket that opened this picker (if any) — offered as
    // a one-tap "find similar to what's here" jump. Cold mode resolves it server-side
    // (the coldCards effect above), so guests get the shortcut too.
    const occupant = selectedCardId ? findCard(selectedCardId) : undefined;
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
        // Refinements exist only while EMBEDDING similarity results are on screen — they extend the
        // session. Injected result sets (color search) aren't an embedding session, so skip them.
        moreLikeThis: similarAvailable() && similarTo && !similarTo.injected
            ? {
                key: 'more-like-this',
                label: '⊕ More like this',
                onPress: (c) => {
                    setActionCard(null);
                    refineSimilar('more', [c.id]);
                },
            }
            : undefined,
        lessLikeThis: similarAvailable() && similarTo && !similarTo.injected
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
                        onPickCard(c.id, c);
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
        return (_jsx(CardTile, { styles: styles, card: c, width: tileW, 
            // Big tiles pull the 640px thumb so they don't upscale a 245px webp.
            tier: cardTierFor(tileW), selected: c.id === selectedCardId, 
            // In select mode (toggle, or web Ctrl/Shift) a tap toggles selection; else it opens
            // the single-card sheet.
            onPress: () => (isSelecting() ? toggleSelected(c.id) : setActionCard(c)), multiSelected: selectedIds.includes(c.id), 
            // value replaces the name line when sorting by value (keeps row geometry fixed)
            label: effParsed.sort === 'value' && value > 0 ? formatUsd(value) : c.name, 
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
    // The resolved multi-selection — feeds both the batch modal's thumbs and its add-all payload.
    const selectedCards = multiOpen
        ? selectedIds.map((id) => findCard(id)).filter((c) => Boolean(c))
        : [];
    return (_jsxs(View, { style: styles.browser, onLayout: onLayout, children: [_jsxs(View, { style: styles.controls, children: [_jsx(Text, { style: styles.sectionLabel, children: "Cards \u00B7 1\u00D71" }), _jsxs(View, { style: styles.searchRow, children: [_jsx(TextInput, { value: cardQuery, onChangeText: onChangeQuery, placeholder: `Search ${tax?.cardCount ? tax.cardCount.toLocaleString() + ' ' : ''}cards — ${QUERY_HINT}`, placeholderTextColor: theme.faint, autoCorrect: false, clearButtonMode: "while-editing", style: [styles.search, styles.searchFlex] }), _jsx(Pressable, { onPress: () => setHelpOpen((v) => !v), style: [styles.helpBtn, helpOpen && styles.helpBtnOn], hitSlop: 6, accessibilityLabel: "Search syntax help", children: _jsx(Text, { style: [styles.helpBtnText, helpOpen && styles.helpBtnTextOn], children: "?" }) }), onColorSearch ? (_jsx(Pressable, { onPress: onColorSearch, style: styles.colorBtn, hitSlop: 6, accessibilityLabel: "Search by color", children: _jsx(Text, { style: styles.colorBtnText, children: "Color" }) })) : null] }), isCardLevel || !warm ? (_jsxs(View, { children: [_jsxs(View, { style: styles.modeBadge, children: [_jsx(View, { style: [styles.modeDot, warm ? styles.modeDotReady : styles.modeDotLoading] }), _jsx(Text, { style: styles.modeText, numberOfLines: 1, children: warm ? '⚡ On-device search — instant' : loadLabel(catalogStatus, coldSearch) })] }), !warm && catalogStatus.status !== 'error' ? (_jsx(View, { style: styles.progressTrack, children: _jsx(View, { style: [styles.progressFill, { width: `${Math.round(catalogStatus.progress * 100)}%` }] }) })) : null] })) : null, helpOpen ? _jsx(SearchManual, { styles: styles, onClose: () => setHelpOpen(false) }) : null, occupant &&
                        similarAvailable() &&
                        !(similarTo?.ids.length === 1 && similarTo.ids[0] === occupant.id) ? (_jsx(Pressable, { style: styles.pocketSimilar, onPress: () => openSimilar(occupant), children: _jsxs(Text, { style: styles.pocketSimilarText, numberOfLines: 1, children: ["\u2248 Find similar to \u201C", occupant.name, "\u201D (in this pocket)"] }) })) : null, searching ? (_jsxs(View, { style: styles.metaRow, children: [_jsxs(Text, { style: styles.meta, numberOfLines: 1, children: [warm
                                        ? filteredCards.length === viewCards.length
                                            ? `${viewCards.length} result${viewCards.length === 1 ? '' : 's'}`
                                            : `${filteredCards.length} of ${viewCards.length}`
                                        : `${serverTotal} result${serverTotal === 1 ? '' : 's'}${serverLoading ? '…' : ''}`, ' · ', describeQuery(effParsed, viewCards)] }), _jsx(Pressable, { onPress: () => onChangeQuery(''), hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })] })) : similarTo ? (_jsxs(View, { style: styles.similarBar, children: [_jsxs(View, { style: styles.metaRow, children: [_jsx(Text, { style: styles.meta, numberOfLines: 1, children: similarTo.injected
                                            ? similarCards.length > 0
                                                ? `${filteredCards.length} cards · ${similarTo.name}`
                                                : similarBusy
                                                    ? 'Loading…'
                                                    : `No matches · ${similarTo.name}`
                                            : similarCards.length > 0
                                                ? `${filteredCards.length} cards similar to${similarTo.ids.length > 1 ? ' all of' : ''}${refineNote}:`
                                                : similarBusy
                                                    ? 'Finding similar cards…'
                                                    : 'No similar cards found.' }), !similarTo.injected && !similarBusy && similarCards.length === 0 ? (_jsx(Pressable, { onPress: () => runSimilar(similarSteps), hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Retry" }) })) : null, _jsx(Pressable, { onPress: clearSimilar, hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })] }), _jsx(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.similarThumbs, keyboardShouldPersistTaps: "handled", children: similarTo.ids.map((sid) => {
                                    const src = findCard(sid);
                                    const uri = cardThumbUrl(sid, 245);
                                    return (_jsx(Pressable, { style: styles.similarThumb, onPress: () => src && setActionCard(src), children: uri ? (_jsx(Image, { source: { uri }, style: styles.cardImage, contentFit: "contain", cachePolicy: "memory-disk", recyclingKey: sid, transition: 80 })) : (_jsx(View, { style: styles.cardImageFallback, children: _jsx(Text, { style: styles.cardImageFallbackText, children: src?.name?.slice(0, 1) ?? '?' }) })) }, sid));
                                }) })] })) : seriesId ? (_jsx(Breadcrumb, { styles: styles, crumbs: crumbs })) : (_jsxs(Text, { style: styles.meta, children: [series.length, " series"] })), analyticsScope ? (_jsx(View, { style: styles.tabRow, children: ['cards', 'analytics'].map((t) => {
                            const on = t === analyticsTab;
                            const label = t === 'analytics' ? 'Analytics' : analyticsScope === 'series' ? 'Sets' : 'Cards';
                            // Locked analytics: accent-ring the tab so the gated perk draws the eye.
                            const spotlight = t === 'analytics' && !!analyticsLocked && !on;
                            return (_jsx(Pressable, { onPress: () => setAnalyticsTab(t), style: [styles.tab, on && styles.tabOn, spotlight && styles.tabSpotlight], children: _jsx(Text, { style: [styles.tabText, on && styles.tabTextOn, spotlight && styles.tabTextSpotlight], children: spotlight ? `✨ ${label}` : label }) }, t));
                        }) })) : null, isCardLevel && facetOptions.length > 0 && !analyticsView ? (_jsx(FacetBar, { styles: styles, options: facetOptions, selection: selection, activeCount: activeFilterCount, open: filtersOpen, onToggleOpen: () => setFiltersOpen((v) => !v), onToggleValue: toggleFacetValue, onClear: clearFilters })) : null, isCardLevel && !analyticsView ? (_jsx(SortBar, { styles: styles, field: effSort.field, dir: effSort.dir, onPick: pickSort, onToggleDir: toggleSortDir, size: cardSize, onPickSize: pickCardSize })) : null, isCardLevel && canMultiSelect && !analyticsView ? (_jsx(View, { style: styles.selectRow, children: multiSelectMode || selectedIds.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs(Text, { style: styles.selectMeta, numberOfLines: 1, children: [selectedIds.length, " selected", selectedIds.length < 2 ? ' · tap 2+' : ''] }), _jsx(Pressable, { disabled: selectedIds.length < 2, onPress: () => setMultiOpen(true), style: [styles.selectBtn, selectedIds.length < 2 && styles.selectBtnOff], children: _jsx(Text, { style: styles.selectBtnText, children: "Continue \u2192" }) }), _jsx(Pressable, { onPress: () => {
                                        setMultiSelectMode(false);
                                        clearSelection();
                                    }, hitSlop: 8, children: _jsx(Text, { style: styles.clear, children: "Cancel" }) })] })) : (_jsx(Pressable, { onPress: () => setMultiSelectMode(true), style: styles.selectToggle, children: _jsx(Text, { style: styles.selectToggleText, children: "\u2295 Select multiple" }) })) })) : null] }), analyticsView ? (_jsx(ScrollView, { style: styles.list, contentContainerStyle: styles.analyticsContent, children: analyticsLocked ? (
                // Gated (e.g. guest): the app-supplied CTA replaces the analytics panels.
                analyticsLocked) : catalog && analyticsScope === 'set' && setId ? (_jsx(SetAnalytics, { catalog: catalog, setId: setId, onOpenCard: openCard, theme: theme })) : catalog && analyticsScope === 'series' && seriesId ? (_jsx(SeriesAnalytics, { catalog: catalog, seriesId: seriesId, onOpenCard: openCard, theme: theme })) : null })) : (_jsx(FlatList
            // Remount when the level or column count changes so numColumns/getItemLayout stay
            // consistent (FlatList can't change numColumns in place).
            , { style: styles.list, 
                // Render a growing window of the (uncapped) results — reveal more as you scroll.
                data: visibleData, keyExtractor: keyFor, renderItem: renderItem, numColumns: cols, columnWrapperStyle: cols > 1 ? styles.column : undefined, contentContainerStyle: styles.listContent, getItemLayout: getItemLayout, 
                // Hide the scrollbar indicator (scroll still works) — the grid reads cleaner without it.
                showsVerticalScrollIndicator: false, keyboardShouldPersistTaps: "handled", keyboardDismissMode: "on-drag", onEndReachedThreshold: 0.8, onEndReached: onEndReached, initialNumToRender: cols * 6, maxToRenderPerBatch: cols * 4, windowSize: 9, removeClippedSubviews: true, ListEmptyComponent: _jsx(Text, { style: styles.empty, children: searching
                        ? !warm && serverLoading
                            ? 'Searching…'
                            : `No cards match “${q}”.`
                        : level === 'coldidle'
                            ? coldSearch
                                ? 'Type to search all cards.'
                                : 'Loading cards…'
                            : level === 'similar'
                                ? similarBusy
                                    ? 'Searching…'
                                    : similarTo?.injected
                                        ? 'No color matches.'
                                        : 'No similar cards found — tap Retry above.'
                                : level === 'cards'
                                    ? !catalog && coldSetLoading
                                        ? 'Loading set…'
                                        : 'No cards in this set.'
                                    : 'Nothing here.' }), ListFooterComponent: _jsx(View, { style: styles.footer, children: footer }) }, `lvl-${level}-c${cols}`)), actionCard ? (_jsx(CardActionModal, { card: actionCard, actions: actionsFor(actionCard), value: priceOf(actionCard.id), onClose: () => setActionCard(null), theme: theme })) : null, multiOpen ? (_jsx(MultiCardActionModal, { cards: selectedCards, onAddAll: onPickCards ? () => onPickCards(selectedIds, selectedCards) : undefined, addAllLabel: pickCardsLabel, onFindSimilarAll: similarAvailable() ? () => openSimilarMany(selectedIds) : undefined, onMoreLikeAll: similarAvailable() && similarTo && !similarTo.injected ? () => refineSimilar('more', selectedIds) : undefined, onLessLikeAll: similarAvailable() && similarTo && !similarTo.injected ? () => refineSimilar('less', selectedIds) : undefined, onClose: () => {
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
function CardTile({ styles, card, width, tier = 245, selected, multiSelected, onPress, label, value, quickAction, }) {
    // Grid tier: the 245px webp (~20KB) by default; large tiles request 640px so they stay sharp.
    const uri = cardThumbUrl(card.id, tier);
    return (_jsxs(Pressable, { style: [styles.cardTile, { width }, selected && styles.cardTileSelected, multiSelected && styles.cardTileMulti], onPress: onPress, children: [_jsxs(View, { style: styles.cardImageWrap, children: [uri ? (_jsx(Image, { source: { uri }, style: styles.cardImage, contentFit: "contain", cachePolicy: "memory-disk", recyclingKey: card.id, transition: 100 })) : (_jsx(View, { style: styles.cardImageFallback, children: _jsx(Text, { style: styles.cardImageFallbackText, children: "no image" }) })), multiSelected ? (_jsx(View, { style: styles.cardCheck, children: _jsx(Text, { style: styles.cardCheckText, children: "\u2713" }) })) : null, card.language === 'ja' ? (_jsx(View, { style: styles.cardLangBadge, children: _jsx(Text, { style: styles.cardLangBadgeText, children: "JP" }) })) : null, quickAction ? (_jsx(Pressable, { style: styles.cardQuick, hitSlop: 6, onPress: () => quickAction.onPress(card), accessibilityLabel: typeof quickAction.label === 'string' ? quickAction.label : 'Quick action', children: _jsx(Text, { style: styles.cardQuickText, numberOfLines: 1, children: typeof quickAction.label === 'function' ? quickAction.label(card) : quickAction.label }) })) : null] }), _jsx(Text, { style: styles.cardName, numberOfLines: 1, children: label ?? card.name }), value != null && value > 0 ? (_jsx(Text, { style: styles.cardValue, numberOfLines: 1, children: formatUsd(value) })) : null] }));
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
 * Compact sort control: a "Sort" label, a horizontal row of single-select field chips, and a
 * ↑/↓ direction toggle (hidden for Relevance, which has no direction). Mirrors the FacetBar chip
 * look. The chips drive the SAME sort the search box's `sort:` grammar sets.
 */
function SortBar({ styles, field, dir, onPick, onToggleDir, size, onPickSize, }) {
    return (_jsxs(View, { style: styles.facetGroup, children: [_jsx(Text, { style: styles.facetLabel, children: "Sort" }), _jsx(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, style: styles.sortScroll, contentContainerStyle: styles.chipRow, keyboardShouldPersistTaps: "handled", children: SORT_OPTIONS.map((o) => {
                    const on = o.field === field;
                    return (_jsx(Pressable, { onPress: () => onPick(o.field), style: [styles.chip, on && styles.chipOn], children: _jsx(Text, { style: [styles.chipText, on && styles.chipTextOn], numberOfLines: 1, children: o.label }) }, o.field));
                }) }), field !== 'relevance' ? (_jsx(Pressable, { onPress: onToggleDir, style: styles.sortDir, accessibilityLabel: "Toggle sort direction", children: _jsx(Text, { style: styles.sortDirText, children: dir === 'asc' ? '↑' : '↓' }) })) : null, _jsx(View, { style: styles.sizeChips, children: SIZE_OPTIONS.map((o) => {
                    const on = o.size === size;
                    return (_jsx(Pressable, { onPress: () => onPickSize(o.size), style: [styles.sizeChip, on && styles.chipOn], accessibilityLabel: `Card size ${o.label}`, children: _jsx(Text, { style: [styles.chipText, on && styles.chipTextOn], children: o.label }) }, o.size));
                }) })] }));
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
        // analyticsLocked spotlight: accent ring + accent label on the inactive Analytics tab.
        tabSpotlight: { borderWidth: 1, borderColor: t.accent },
        tabTextSpotlight: { color: t.accent },
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
        colorBtn: {
            height: 30,
            borderRadius: 15,
            borderWidth: 1,
            borderColor: t.border,
            paddingHorizontal: 12,
            alignItems: 'center',
            justifyContent: 'center',
        },
        colorBtnText: { fontSize: 12, fontWeight: '700', color: t.subtext },
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
        // inline card-size control (S/M/L) pinned at the end of the sort row
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
            ...tileShadow,
        },
        taxLogoWrap: {
            // Fill the tile's free height so cover art is large (grows if taxTileHeight grows); the name
            // + meta below stay at their intrinsic height.
            flex: 1,
            minHeight: 84,
            borderRadius: 6,
            backgroundColor: t.imagePlaceholder,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
        },
        taxLogo: { width: '100%', height: '100%' },
        taxInitial: { fontSize: 29, fontWeight: '800', color: t.faint },
        // Series/set tile text — ~33% larger than the dense card labels.
        taxTitle: { fontSize: 16, fontWeight: '700', color: t.text, lineHeight: 20 },
        taxMeta: { fontSize: 13, color: t.subtext, lineHeight: 17 },
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
        // Japanese-printing badge (bottom-right of the thumb; EN cards show nothing)
        cardLangBadge: {
            position: 'absolute',
            bottom: 3,
            right: 3,
            paddingHorizontal: 4,
            paddingVertical: 1,
            borderRadius: 4,
            backgroundColor: t.accent,
        },
        cardLangBadgeText: { color: t.accentText, fontSize: 9, fontWeight: '800', lineHeight: 12 },
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
