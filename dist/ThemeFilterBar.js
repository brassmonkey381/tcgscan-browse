import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The theme toolbar for artwork search: a SECONDARY GAME'S (CatalogBrowser's `themeServer`, whose
 * controls are `theme_search` parameters) and, since 0.9.29, Pokemon's (`themeTools`, whose controls
 * ride on `search_cards` as extra p_fields; see search.ts ThemeToolbar).
 *
 * Three controls, all of them server parameters rather than filters over the rows on screen, so
 * changing one re-asks the server:
 *   · a segmented control: All art / Full art / Windowed (`p_frame`);
 *   · type chips from the game's registry row (`p_types`, OR-ed: a Lorcana ink, a One Piece
 *     colour, and the dual-ink / multicolour groups), each with its count;
 *   · a "Group by {typeLabel}" switch (`p_group`), which puts the result in registry order.
 *
 * The counts come from `theme_facets` (Pokemon: `search_facets`, once it answers them) and are
 * exclude-self (the frame counts ignore the frame, the type counts ignore the chips), so every
 * option says what picking it would return. When that call failed or has no counts (`counts` null)
 * the chips stay and the numbers go; nothing here is counted on the device,
 * because a dual-ink hit counts under its group AND each ink, which a page of hits cannot say.
 *
 * COMPACT (0.9.30). On a phone the full bar was seven rows: the segment, the Group switch, and
 * fifteen Pokemon energy chips wrapping five deep, all above the first card (owner, 2026-10-18:
 * "this clutter is not functional, on mobile"). With `compact` the segment drops its counts and
 * the chips fold into one dropdown chip ("Energy ▾", or "Energy · 2 ▾" with a pick) that opens a
 * sheet, the same shape as the browser's own facet dropdowns; the Group switch rides beside it.
 * Two rows, and every option still says what picking it would return.
 *
 * Presentational only: the browser owns the state, persists it (browseState, the share link, a
 * starred search) and runs the queries. Colours come from the injected BrowseTheme, the chip
 * shapes match the browser's own, and a group's registry colour is only ever a small dot, so a
 * pale ink never has to carry text.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
const FRAME_OPTIONS = [
    { frame: 'all', label: 'All art' },
    { frame: 'full', label: 'Full art' },
    { frame: 'window', label: 'Windowed' },
];
export function ThemeFilterBar({ theme, frame, onPickFrame, typeGroups, typeLabel, types, onToggleType, onClearTypes, group, onToggleGroup, counts, compact = false, }) {
    const styles = useMemo(() => makeStyles(theme), [theme]);
    const [sheetOpen, setSheetOpen] = useState(false);
    const groups = typeGroups ?? [];
    const label = typeLabel?.trim() || 'type';
    // Every card is full art or windowed, so "All art" is their sum (the frame counts already
    // ignore the frame, so this is what "All art" would return).
    const frameCount = (f) => {
        if (!counts)
            return null;
        if (f === 'all')
            return (counts.frame.full ?? 0) + (counts.frame.window ?? 0);
        return counts.frame[f] ?? 0;
    };
    // A chip that would return nothing is left out, unless it is picked (it must stay clearable).
    // Without counts every chip shows: an unknown count is not a zero.
    const visibleGroups = groups.filter((g) => !counts || (counts.type[g.key] ?? 0) > 0 || types.includes(g.key));
    const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
    const pickedSummary = types.length === 0 ? '' : types.length === 1 ? groups.find((g) => g.key === types[0])?.label ?? types[0] : `${types.length}`;
    /** One type row: the registry dot, the label, the count, and a check when picked. */
    const typeRow = (g, inSheet) => {
        const on = types.includes(g.key);
        const n = counts ? counts.type[g.key] ?? 0 : null;
        return (_jsxs(Pressable, { onPress: () => onToggleType(g.key), style: inSheet ? [styles.menuItem, on && styles.menuItemOn] : [styles.chip, on && styles.chipOn], accessibilityRole: "checkbox", accessibilityState: { checked: on }, accessibilityLabel: n == null ? g.label : `${g.label}, ${n} matches`, children: [_jsx(View, { style: [styles.dot, { backgroundColor: g.color || theme.faint }] }), _jsxs(Text, { style: inSheet ? [styles.menuItemText, on && styles.menuItemTextOn] : [styles.chipText, on && styles.chipTextOn], numberOfLines: 1, children: [g.label, n == null ? '' : ` ${n.toLocaleString()}`] }), inSheet ? _jsx(Text, { style: [styles.menuCheck, on && styles.menuItemTextOn], children: on ? '✓' : '' }) : null] }, g.key));
    };
    if (compact) {
        return (_jsxs(View, { style: styles.bar, children: [_jsxs(View, { style: styles.row, children: [_jsx(View, { style: styles.segment, accessibilityRole: "radiogroup", children: FRAME_OPTIONS.map((o, i) => {
                                const on = o.frame === frame;
                                const n = frameCount(o.frame);
                                return (_jsx(Pressable, { onPress: () => onPickFrame(o.frame), style: [styles.segmentItem, i > 0 && styles.segmentDivider, on && styles.segmentItemOn], accessibilityRole: "radio", accessibilityState: { checked: on }, accessibilityLabel: n == null ? o.label : `${o.label}, ${n} matches`, children: _jsx(Text, { style: [styles.segmentText, on && styles.segmentTextOn], numberOfLines: 1, children: o.label }) }, o.frame));
                            }) }), groups.length > 0 ? (_jsxs(_Fragment, { children: [_jsx(Pressable, { onPress: () => setSheetOpen(true), style: [styles.toggle, types.length > 0 && styles.toggleOn], accessibilityRole: "button", accessibilityLabel: `${labelCap}${pickedSummary ? `: ${pickedSummary}` : ''}`, children: _jsxs(Text, { style: [styles.toggleText, types.length > 0 && styles.toggleTextOn], numberOfLines: 1, children: [labelCap, pickedSummary ? ` · ${pickedSummary}` : '', ' ▾'] }) }), _jsx(Pressable, { onPress: onToggleGroup, style: [styles.toggle, group && styles.toggleOn], accessibilityRole: "switch", accessibilityState: { checked: group }, accessibilityLabel: `Group by ${label}`, children: _jsxs(Text, { style: [styles.toggleText, group && styles.toggleTextOn], numberOfLines: 1, children: [group ? '☑' : '☐', " Group"] }) })] })) : null] }), sheetOpen ? (_jsx(Modal, { visible: true, transparent: true, animationType: "fade", onRequestClose: () => setSheetOpen(false), children: _jsx(Pressable, { style: styles.menuBackdrop, onPress: () => setSheetOpen(false), children: _jsxs(Pressable, { style: styles.menuSheet, onPress: () => { }, children: [_jsxs(View, { style: styles.menuHead, children: [_jsx(Text, { style: styles.menuTitle, children: labelCap }), types.length > 0 ? (_jsx(Pressable, { onPress: onClearTypes, hitSlop: 8, accessibilityRole: "button", accessibilityLabel: `Clear ${label} chips`, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })) : null] }), _jsx(ScrollView, { style: styles.menuList, keyboardShouldPersistTaps: "handled", children: visibleGroups.map((g) => typeRow(g, true)) }), _jsx(Pressable, { onPress: () => setSheetOpen(false), style: styles.menuDone, accessibilityRole: "button", children: _jsx(Text, { style: styles.menuDoneText, children: "Done" }) })] }) }) })) : null] }));
    }
    return (_jsxs(View, { style: styles.bar, children: [_jsxs(View, { style: styles.row, children: [_jsx(View, { style: styles.segment, accessibilityRole: "radiogroup", children: FRAME_OPTIONS.map((o, i) => {
                            const on = o.frame === frame;
                            const n = frameCount(o.frame);
                            return (_jsx(Pressable, { onPress: () => onPickFrame(o.frame), style: [styles.segmentItem, i > 0 && styles.segmentDivider, on && styles.segmentItemOn], accessibilityRole: "radio", accessibilityState: { checked: on }, accessibilityLabel: n == null ? o.label : `${o.label}, ${n} matches`, children: _jsxs(Text, { style: [styles.segmentText, on && styles.segmentTextOn], numberOfLines: 1, children: [o.label, n == null ? '' : ` ${n.toLocaleString()}`] }) }, o.frame));
                        }) }), groups.length > 0 ? (_jsx(Pressable, { onPress: onToggleGroup, style: [styles.toggle, group && styles.toggleOn], accessibilityRole: "switch", accessibilityState: { checked: group }, accessibilityLabel: `Group by ${label}`, children: _jsxs(Text, { style: [styles.toggleText, group && styles.toggleTextOn], numberOfLines: 1, children: [group ? '☑' : '☐', " Group by ", label.toLowerCase()] }) })) : null, types.length > 0 ? (_jsx(Pressable, { onPress: onClearTypes, hitSlop: 8, accessibilityRole: "button", accessibilityLabel: `Clear ${label} chips`, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })) : null] }), visibleGroups.length > 0 ? _jsx(View, { style: styles.row, children: visibleGroups.map((g) => typeRow(g, false)) }) : null] }));
}
function makeStyles(t) {
    return StyleSheet.create({
        bar: { gap: 6 },
        // Wraps rather than scrolling sideways, like the browser's control strip.
        row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
        segment: {
            flexDirection: 'row',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
            overflow: 'hidden',
        },
        segmentItem: { paddingHorizontal: 10, paddingVertical: 5 },
        segmentDivider: { borderLeftWidth: 1, borderLeftColor: t.border },
        segmentItemOn: { backgroundColor: t.accent },
        segmentText: { fontSize: 12, fontWeight: '600', color: t.subtext },
        segmentTextOn: { color: t.accentText },
        toggle: {
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
        },
        toggleOn: { borderColor: t.accent },
        toggleText: { fontSize: 12, fontWeight: '600', color: t.subtext },
        toggleTextOn: { color: t.accent },
        chip: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.border,
            maxWidth: 180,
        },
        chipOn: { backgroundColor: t.accent, borderColor: t.accent },
        chipText: { fontSize: 12, fontWeight: '600', color: t.subtext, flexShrink: 1 },
        chipTextOn: { color: t.accentText },
        dot: { width: 8, height: 8, borderRadius: 4 },
        clear: { fontSize: 13, fontWeight: '600', color: t.accent },
        // The compact dropdown's sheet: the browser's PickerMenu shape, in this bar's own colours.
        menuBackdrop: { flex: 1, backgroundColor: t.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 },
        menuSheet: { width: '100%', maxWidth: 360, maxHeight: '80%', borderRadius: 14, backgroundColor: t.background, padding: 10, gap: 6 },
        menuHead: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingBottom: 6,
        },
        menuTitle: { fontSize: 15, fontWeight: '700', color: t.text },
        menuList: { paddingHorizontal: 8 },
        menuItem: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 10,
            paddingHorizontal: 10,
            borderRadius: 8,
        },
        menuItemOn: { backgroundColor: t.selected },
        menuItemText: { flex: 1, fontSize: 14, color: t.text },
        menuItemTextOn: { color: t.accent, fontWeight: '600' },
        menuCheck: { fontSize: 14, color: t.subtext, width: 18, textAlign: 'right' },
        menuDone: { alignSelf: 'center', marginTop: 8, paddingVertical: 8, paddingHorizontal: 24 },
        menuDoneText: { fontSize: 14, fontWeight: '700', color: t.accent },
    });
}
