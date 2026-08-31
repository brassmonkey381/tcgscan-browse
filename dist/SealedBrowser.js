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
 * THE HOST DECIDES WHO SEES IT, by importing it or not. This is the kit's existing way of having
 * a surface one app shows and the other does not — RecentProducts is michi's and tcgscan-app
 * mounts it nowhere; this is the mirror image. No flag, no lock, no platform sniff: a
 * BrowseFeature would be wrong by construction (that union is the TIER seam, and a locked
 * feature is meant to stay VISIBLE and advertise a plan), and a runtime app check is forbidden
 * outright.
 *
 * Search stays a substring over name + series rather than the kit's query grammar. The grammar
 * assumes a card — half its vocabulary (artist:, rarity:, hp>N, sort:stage) would match zero
 * sealed rows without saying so, and its name-word heuristic actively suppresses set matches for
 * a word that hits several card names, which is most of what a sealed product is called. Adopting
 * it means an adapter, a sealed manual, and an unsupported-field notice — a separate piece of
 * work, not a promotion.
 */
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LanguageToggle } from './LanguageToggle';
import { useBrowseLanguages } from './language';
import { formatUsd } from './prices';
import { SEALED_GROUPS, sealedGroupOf } from './sealed-groups';
import { sealedLanguageOf, useSealed } from './sealed';
import { resolveTheme, tileShadow } from './theme';
export function SealedBrowser({ theme: themeProp, languages, numColumns = 2, onOpen, onAdd, addLabel = '＋', }) {
    const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const { sealed, priceOf, status } = useSealed();
    const [shared] = useBrowseLanguages();
    const langs = languages ?? shared;
    const [query, setQuery] = useState('');
    const [group, setGroup] = useState('all');
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
    if (status !== 'ready') {
        return (_jsx(View, { style: styles.empty, children: _jsx(Text, { style: styles.emptyText, children: status === 'error'
                    ? 'Sealed products aren’t available right now.'
                    : 'Loading sealed products…' }) }));
    }
    const searching = query.trim().length > 0;
    return (_jsxs(View, { style: styles.wrap, children: [_jsxs(View, { style: styles.controls, children: [_jsx(TextInput, { value: query, onChangeText: setQuery, placeholder: "Search sealed products\u2026", placeholderTextColor: theme.faint, autoCorrect: false, autoCapitalize: "none", style: styles.search }), languages ? null : _jsx(LanguageToggle, { theme: themeProp }), _jsx(ScrollView, { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.chipRow, children: [{ key: 'all', label: 'Everything' }, ...SEALED_GROUPS].map((g) => (_jsx(Pressable, { onPress: () => setGroup(g.key), accessibilityRole: "button", accessibilityState: { selected: group === g.key }, style: [styles.chip, group === g.key && styles.chipOn], children: _jsx(Text, { style: styles.chipText, children: g.label }) }, g.key))) })] }), shown.length === 0 ? (_jsx(View, { style: styles.empty, children: _jsx(Text, { style: styles.emptyText, children: searching ? `Nothing matches “${query.trim()}”.` : 'No sealed products here.' }) })) : (_jsx(FlatList, { data: shown, keyExtractor: (p) => p.id, numColumns: numColumns, columnWrapperStyle: numColumns > 1 ? styles.row : undefined, contentContainerStyle: styles.grid, renderItem: ({ item: p }) => {
                    const price = formatUsd(priceOf(p.id));
                    return (_jsxs(Pressable, { style: styles.tile, accessibilityRole: onOpen ? 'button' : undefined, accessibilityLabel: p.name, disabled: !onOpen, onPress: onOpen ? () => onOpen(p) : undefined, children: [_jsx(Image, { source: { uri: p.imageSmall || p.image }, style: styles.art, contentFit: "contain", transition: 100 }), _jsx(Text, { style: styles.name, numberOfLines: 2, children: p.name }), _jsxs(View, { style: styles.tileFoot, children: [_jsx(Text, { style: styles.price, children: price }), onAdd ? (_jsx(Pressable, { hitSlop: 8, accessibilityRole: "button", accessibilityLabel: `Add ${p.name}`, onPress: () => onAdd(p), children: _jsx(Text, { style: styles.add, children: addLabel }) })) : null] })] }));
                } }, numColumns))] }));
}
function makeStyles(t) {
    return StyleSheet.create({
        wrap: { flex: 1 },
        controls: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
        search: {
            borderRadius: 8,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.panel,
            color: t.text,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 15,
        },
        chipRow: { flexDirection: 'row', gap: 8 },
        chip: {
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.panel,
        },
        chipOn: { backgroundColor: t.selected, borderColor: t.accent },
        chipText: { color: t.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
        grid: { padding: 12, gap: 8 },
        row: { gap: 8 },
        tile: {
            flex: 1,
            borderRadius: 12,
            padding: 10,
            gap: 6,
            backgroundColor: t.panel,
            borderWidth: 1,
            borderColor: t.border,
            ...tileShadow,
        },
        art: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: t.imagePlaceholder },
        name: { color: t.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
        tileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        price: { color: t.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
        add: { color: t.link, fontSize: 16, lineHeight: 22, fontWeight: '700' },
        empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
        emptyText: { color: t.subtext, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    });
}
