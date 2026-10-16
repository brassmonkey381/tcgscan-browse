import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
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
 * Presentational only: the browser owns the state, persists it (browseState, the share link, a
 * starred search) and runs the queries. Colours come from the injected BrowseTheme, the chip
 * shapes match the browser's own, and a group's registry colour is only ever a small dot, so a
 * pale ink never has to carry text.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
const FRAME_OPTIONS = [
    { frame: 'all', label: 'All art' },
    { frame: 'full', label: 'Full art' },
    { frame: 'window', label: 'Windowed' },
];
export function ThemeFilterBar({ theme, frame, onPickFrame, typeGroups, typeLabel, types, onToggleType, onClearTypes, group, onToggleGroup, counts, }) {
    const styles = useMemo(() => makeStyles(theme), [theme]);
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
    return (_jsxs(View, { style: styles.bar, children: [_jsxs(View, { style: styles.row, children: [_jsx(View, { style: styles.segment, accessibilityRole: "radiogroup", children: FRAME_OPTIONS.map((o, i) => {
                            const on = o.frame === frame;
                            const n = frameCount(o.frame);
                            return (_jsx(Pressable, { onPress: () => onPickFrame(o.frame), style: [styles.segmentItem, i > 0 && styles.segmentDivider, on && styles.segmentItemOn], accessibilityRole: "radio", accessibilityState: { checked: on }, accessibilityLabel: n == null ? o.label : `${o.label}, ${n} matches`, children: _jsxs(Text, { style: [styles.segmentText, on && styles.segmentTextOn], numberOfLines: 1, children: [o.label, n == null ? '' : ` ${n.toLocaleString()}`] }) }, o.frame));
                        }) }), groups.length > 0 ? (_jsx(Pressable, { onPress: onToggleGroup, style: [styles.toggle, group && styles.toggleOn], accessibilityRole: "switch", accessibilityState: { checked: group }, accessibilityLabel: `Group by ${label}`, children: _jsxs(Text, { style: [styles.toggleText, group && styles.toggleTextOn], numberOfLines: 1, children: [group ? '☑' : '☐', " Group by ", label.toLowerCase()] }) })) : null, types.length > 0 ? (_jsx(Pressable, { onPress: onClearTypes, hitSlop: 8, accessibilityRole: "button", accessibilityLabel: `Clear ${label} chips`, children: _jsx(Text, { style: styles.clear, children: "Clear" }) })) : null] }), visibleGroups.length > 0 ? (_jsx(View, { style: styles.row, children: visibleGroups.map((g) => {
                    const on = types.includes(g.key);
                    const n = counts ? counts.type[g.key] ?? 0 : null;
                    return (_jsxs(Pressable, { onPress: () => onToggleType(g.key), style: [styles.chip, on && styles.chipOn], accessibilityRole: "checkbox", accessibilityState: { checked: on }, accessibilityLabel: n == null ? g.label : `${g.label}, ${n} matches`, children: [_jsx(View, { style: [styles.dot, { backgroundColor: g.color || theme.faint }] }), _jsxs(Text, { style: [styles.chipText, on && styles.chipTextOn], numberOfLines: 1, children: [g.label, n == null ? '' : ` ${n.toLocaleString()}`] })] }, g.key));
                }) })) : null] }));
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
    });
}
