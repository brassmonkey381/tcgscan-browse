import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Pressable, StyleSheet, Text, View } from 'react-native';
/**
 * THE MULTI-SELECT BUTTON, ONE STYLE EVERYWHERE (owner, MIC-039, 2026-11-15: "standardize this
 * multi-select button in its normal, selected, active, disabled, etc. states, as well as its
 * symbol and text everywhere it appears"). Exported so a host's own select control (michi-maker's
 * editor) can draw the very same pill instead of a copy of it.
 *
 *  - idle:      outline pill, 1px `border`, `text` ink: [⧉ Select]
 *  - selecting: solid pill on `selectFill(theme)` with `accentText` ink, at least 4.5:1:
 *               [⧉ N selected · tap 2+], then [⧉ Continue with N cards]
 *  - pressed:   opacity 0.7
 *  - disabled:  opacity 0.45 (not pressable)
 *
 * The glyph is ⧉ (two overlapping squares), drawn with two bordered Views rather than set in a
 * font, so it looks the same on every platform whether or not the font carries U+29C9.
 */
/** WCAG relative luminance of a #rgb / #rrggbb colour; null for anything else. */
function luminance(hex) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m)
        return null;
    let h = m[1];
    if (h.length === 3)
        h = h.split('').map((c) => c + c).join('');
    const ch = [0, 2, 4].map((i) => {
        const v = parseInt(h.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
/** WCAG contrast ratio between two #hex colours; null when either is not a #hex colour. */
export function contrastRatio(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    if (la == null || lb == null)
        return null;
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function toHex(r, g, b) {
    return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
/** Hand-picked deeper shades for known accents (the kit's default blue: Tailwind blue-700). */
const KNOWN_DEEP = { '#3b82f6': '#1d4ed8' };
/** Small text needs 4.5:1 (WCAG AA). */
const MIN_CONTRAST = 4.5;
/**
 * The fill of an ON select pill: the theme's `accent` when `accentText` already reads at 4.5:1 on
 * it (a host whose accent passes keeps it exactly), else a deeper shade of the accent (or a lighter
 * one, when `accentText` is dark) stepped until it does. The default blue maps to #1d4ed8 (6.70:1
 * with white). Colours that are not #hex fall back to the accent unchanged.
 */
export function selectFill(t) {
    const accent = t.accent.trim().toLowerCase();
    const ink = t.accentText;
    const now = contrastRatio(accent, ink);
    if (now == null || now >= MIN_CONTRAST)
        return t.accent;
    const known = KNOWN_DEEP[accent];
    if (known && (contrastRatio(known, ink) ?? 0) >= MIN_CONTRAST)
        return known;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(accent);
    if (!m)
        return t.accent;
    let h = m[1];
    if (h.length === 3)
        h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const darken = (luminance(ink) ?? 1) > 0.5; // light ink: deepen the fill; dark ink: lighten it
    for (let step = 1; step <= 20; step++) {
        const k = step * 0.05;
        const c = darken
            ? toHex(r * (1 - k), g * (1 - k), b * (1 - k))
            : toHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k);
        if ((contrastRatio(c, ink) ?? 0) >= MIN_CONTRAST)
            return c;
    }
    return darken ? '#000000' : '#ffffff';
}
/** ⧉ drawn as two overlapping outlined squares, in `color`. */
export function SelectGlyph({ color, size = 11 }) {
    const sq = Math.round(size * 0.7);
    const off = size - sq;
    return (_jsxs(View, { style: { width: size, height: size }, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants", children: [_jsx(View, { style: [glyph.sq, { width: sq, height: sq, borderColor: color, left: 0, top: 0 }] }), _jsx(View, { style: [glyph.sq, { width: sq, height: sq, borderColor: color, left: off, top: off }] })] }));
}
const glyph = StyleSheet.create({
    sq: { position: 'absolute', borderWidth: 1.25, borderRadius: 1.5 },
});
/** Labels used by the kit's own select control. */
export function multiSelectOnLabel(count) {
    return `${count} selected · tap 2+`;
}
export function MultiSelectButton({ theme: t, on, count = 0, onLabel, label = 'Select', disabled, onPress, accessibilityLabel, }) {
    const fill = selectFill(t);
    const ink = on ? t.accentText : t.text;
    const text = on ? onLabel ?? multiSelectOnLabel(count) : label;
    return (_jsxs(Pressable, { onPress: onPress, disabled: disabled || !onPress, role: "button", "aria-pressed": on, "aria-disabled": disabled || undefined, accessibilityLabel: accessibilityLabel, hitSlop: 8, style: ({ pressed }) => [
            pill.base,
            on ? { backgroundColor: fill, borderColor: fill } : { backgroundColor: 'transparent', borderColor: t.border },
            disabled ? pill.disabled : pressed ? pill.pressed : null,
        ], children: [_jsx(SelectGlyph, { color: ink }), _jsx(Text, { style: [pill.text, { color: ink }], numberOfLines: 1, children: text })] }));
}
/**
 * The pill's metrics. Slim (2px + 1px border around a 16px line, 22px tall) so it sits in the
 * results line without growing it; `hitSlop` 8 keeps the touch area at 38px.
 */
export const MULTI_SELECT_PILL = {
    paddingVertical: 2,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 999,
    gap: 5,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    glyphSize: 11,
    pressedOpacity: 0.7,
    disabledOpacity: 0.45,
};
const pill = StyleSheet.create({
    base: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: MULTI_SELECT_PILL.gap,
        paddingVertical: MULTI_SELECT_PILL.paddingVertical,
        paddingHorizontal: MULTI_SELECT_PILL.paddingHorizontal,
        borderWidth: MULTI_SELECT_PILL.borderWidth,
        borderRadius: MULTI_SELECT_PILL.borderRadius,
    },
    text: {
        fontSize: MULTI_SELECT_PILL.fontSize,
        fontWeight: MULTI_SELECT_PILL.fontWeight,
        lineHeight: MULTI_SELECT_PILL.lineHeight,
    },
    pressed: { opacity: MULTI_SELECT_PILL.pressedOpacity },
    disabled: { opacity: MULTI_SELECT_PILL.disabledOpacity },
});
