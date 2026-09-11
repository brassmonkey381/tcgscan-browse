import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, } from 'react-native';
import { LanguageToggle } from './LanguageToggle';
import { CARD_GRID_GAP, CARD_SIZES, cardTileWidthFor } from './cardSize';
import { useBrowseLanguages } from './language';
import { formatUsd } from './prices';
import { releaseTag, RELEASE_TAG_FONT_SIZE, RELEASE_TAG_LINE_HEIGHT } from './releaseTag';
import { SEALED_GROUPS, sealedGroupOf } from './sealed-groups';
import { sealedLanguageOf, useSealed } from './sealed';
import { resolveTheme } from './theme';
/**
 * Columns per Size step, by how wide the grid actually is.
 *
 * These used to be one ladder for every screen — 8 / 6 / 4, derived from the card grid's size
 * fractions so the two shelves moved together. The derivation was tidy and the result was wrong on
 * the device most of this is browsed on: eight columns of a 390pt phone is a 43pt tile, which is a
 * thumbnail of a booster box rather than a picture of one, and even the L step landed at four.
 *
 * So the phone gets its own rung. A SEALED TILE IS NOT A CARD TILE: card art is legible tiny
 * because the whole point of it is one figure on one background, while a sealed tile has to carry
 * a product photo and a set logo, and those die first. 6 / 4 / 2 keeps S dense enough to scan a
 * shelf and lets L be a real look at one box.
 *
 * A TARGET, not a packing: unlike cardGridColumns, which derives a base from the container width,
 * each rung is fixed, so the step means the same thing on every phone rather than drifting a
 * column between a mini and a Max. The width only chooses the rung.
 */
const SEALED_COLUMNS = [
    { upTo: 700, cols: { S: 6, M: 4, L: 2 } },
    { upTo: Infinity, cols: { S: 8, M: 6, L: 4 } },
];
/** The rung `width` falls on. Width 0 (pre-layout) reads as narrow, which is the safe guess. */
function sealedColumns(width, size) {
    const rung = SEALED_COLUMNS.find((r) => width <= r.upTo) ?? SEALED_COLUMNS[SEALED_COLUMNS.length - 1];
    return rung.cols[size];
}
export function SealedBrowser({ theme: themeProp, languages, numColumns, onOpen, onAdd, addLabel = '＋', }) {
    const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { sealed, priceOf, status } = useSealed();
    const [shared] = useBrowseLanguages();
    const langs = languages ?? shared;
    const [query, setQuery] = useState('');
    const [group, setGroup] = useState('all');
    const [size, setSize] = useState('M');
    const [containerWidth, setContainerWidth] = useState(0);
    // 0.5px hysteresis, copied from the card grid: without it a fractional relayout re-renders
    // forever, each pass reporting a width a hair different from the last.
    const onLayout = (e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - containerWidth) > 0.5)
            setContainerWidth(w);
    };
    const cols = numColumns ?? sealedColumns(containerWidth, size);
    const tileW = containerWidth > 0 ? cardTileWidthFor(containerWidth, cols, CARD_GRID_GAP) : 0;
    const wanted = useMemo(() => new Set(langs), 
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity churns; the contents do not
    [langs.join(',')]);
    const shown = useMemo(() => {
        if (!sealed)
            return [];
        const q = query.trim().toLowerCase();
        return sealed
            .newestFirst()
            .filter((p) => wanted.has(sealedLanguageOf(p)))
            .filter((p) => group === 'all' || sealedGroupOf(p.name) === group)
            .filter((p) => !q || `${p.name} ${p.series}`.toLowerCase().includes(q));
    }, [sealed, query, group, wanted]);
    const searching = query.trim().length > 0;
    const emptyText = status === 'loading'
        ? 'Loading sealed products…'
        : status === 'error'
            ? 'Sealed products aren’t available right now.'
            : searching
                ? `Nothing matches “${query.trim()}”.`
                : 'No sealed products here.';
    return (_jsxs(View, { style: styles.wrap, onLayout: onLayout, children: [_jsxs(View, { style: styles.controls, children: [_jsx(Text, { style: styles.sectionLabel, children: "Sealed" }), _jsxs(View, { style: styles.searchRow, children: [_jsx(TextInput, { value: query, onChangeText: setQuery, placeholder: "Search sealed products\u2026", placeholderTextColor: theme.faint, autoCorrect: false, autoCapitalize: "none", clearButtonMode: "while-editing", style: [styles.search, styles.searchFlex] }), languages ? null : _jsx(LanguageToggle, { theme: themeProp })] }), _jsxs(View, { style: styles.facetGroup, children: [_jsxs(View, { style: styles.facetHead, children: [_jsx(Text, { style: styles.facetLabel, children: "Type" }), numColumns ? null : (_jsxs(View, { style: styles.sizeChips, children: [_jsx(Text, { style: styles.facetLabel, children: "Size" }), CARD_SIZES.map((s) => {
                                                const on = s === size;
                                                return (_jsx(Pressable, { onPress: () => setSize(s), accessibilityRole: "button", accessibilityState: { selected: on }, accessibilityLabel: `Tile size ${s}`, style: [styles.sizeChip, on && styles.chipOn], children: _jsx(Text, { style: [styles.chipText, on && styles.chipTextOn], children: s }) }, s));
                                            })] }))] }), _jsx(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, keyboardShouldPersistTaps: "handled", contentContainerStyle: styles.chipRow, children: [{ key: 'all', label: 'Everything', short: 'Everything' }, ...SEALED_GROUPS].map((g) => {
                                    const on = group === g.key;
                                    return (_jsx(Pressable, { onPress: () => setGroup(g.key), accessibilityRole: "button", accessibilityState: { selected: on }, accessibilityLabel: g.label, style: [styles.chip, on && styles.chipOn], children: _jsx(Text, { style: [styles.chipText, on && styles.chipTextOn], numberOfLines: 1, children: g.short }) }, g.key));
                                }) })] })] }), _jsx(FlatList, { data: shown, keyExtractor: (p) => p.id, numColumns: cols, columnWrapperStyle: cols > 1 ? styles.column : undefined, contentContainerStyle: styles.listContent, ListEmptyComponent: _jsx(View, { style: styles.empty, children: _jsx(Text, { style: styles.emptyText, children: emptyText }) }), renderItem: ({ item: p }) => {
                    const price = formatUsd(priceOf(p.id));
                    return (_jsxs(Pressable, { style: [styles.tile, tileW > 0 ? { width: tileW } : null], accessibilityRole: onOpen ? 'button' : undefined, accessibilityLabel: p.name, disabled: !onOpen, onPress: onOpen ? () => onOpen(p) : undefined, children: [_jsxs(View, { style: styles.imageWrap, children: [_jsx(Image, { source: { uri: (tileW >= 150 ? p.imageMedium : p.imageSmall) || p.image }, style: styles.image, contentFit: "contain", transition: 100, recyclingKey: p.id }), onAdd ? (_jsx(Pressable, { hitSlop: 6, accessibilityLabel: `Add ${p.name}`, onPress: () => onAdd(p), style: styles.quick, children: _jsx(Text, { style: styles.quickText, children: addLabel }) })) : null, (() => {
                                        const tag = releaseTag(p.releaseDate);
                                        if (!tag)
                                            return null;
                                        return (_jsx(View, { style: [styles.badge, tag.kind === 'countdown' && styles.badgeCountdown], pointerEvents: "none", children: _jsx(Text, { style: styles.badgeText, numberOfLines: 1, children: tag.label }) }));
                                    })()] }), _jsx(Text, { style: styles.name, numberOfLines: 1, children: p.name }), price ? _jsx(Text, { style: styles.price, children: price }) : null] }));
                } }, cols)] }));
}
function makeStyles(t) {
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
        // A stacked facet block: label + size toggle on one line, the chips full-width under it.
        facetGroup: { gap: 6 },
        facetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        // No fixed width any more — the label shares its line with one right-aligned control
        // instead of holding a column open in front of a scroll view.
        facetLabel: { fontSize: 11, fontWeight: '600', color: t.subtext },
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
        sizeChips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
            // Matches the other release badges; 1pt of vertical padding was set for 8pt text.
            paddingHorizontal: 5,
            paddingVertical: 2,
            backgroundColor: t.accent,
        },
        badgeCountdown: { backgroundColor: t.danger },
        badgeText: {
            color: t.accentText,
            fontSize: RELEASE_TAG_FONT_SIZE,
            lineHeight: RELEASE_TAG_LINE_HEIGHT,
            fontWeight: '800',
            letterSpacing: 0.2,
        },
        name: { fontSize: 9, lineHeight: 12, marginTop: 2, color: t.subtext, textAlign: 'center' },
        // The one coloured thing on a tile, as on the card shelf — this is what the eye lands on.
        price: { fontSize: 9, lineHeight: 12, fontWeight: '700', color: t.accent, textAlign: 'center' },
        empty: { alignItems: 'center', justifyContent: 'center', padding: 24 },
        emptyText: { color: t.subtext, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    });
}
