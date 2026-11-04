import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import { StyleSheet } from 'react-native';
/**
 * THE QUICK-ADD AS A LITTLE SCREEN (owner, 2026-11-03: "a navy screen texture background, and cyan
 * pixel '+' sign"). With the theme's `quickScreen` on, the pill is drawn like the host's screen
 * panels: its fill (`quickFill`) under a faint grid of `quickText` pixels, and the glyph drawn in
 * square pixels rather than set in a font, so it stays crisp at every pill size.
 */
const GLYPHS = {
    plus: ['..#..', '..#..', '#####', '..#..', '..#..'],
    check: ['.....#', '....#.', '#..#..', '.##...', '......'],
};
/** The screen texture: one faint pixel every 4pt, filling its (rounded, clipped) parent. */
export function QuickScreen({ color }) {
    return (_jsxs(Svg, { width: "100%", height: "100%", style: StyleSheet.absoluteFill, pointerEvents: "none", children: [_jsx(Defs, { children: _jsx(Pattern, { id: "kit-quick-screen", width: 4, height: 4, patternUnits: "userSpaceOnUse", children: _jsx(Rect, { x: 1, y: 1, width: 2, height: 2, fill: color, opacity: 0.12 }) }) }), _jsx(Rect, { width: "100%", height: "100%", fill: "url(#kit-quick-screen)" })] }));
}
/** A glyph in square pixels, about 55% of the pill's diameter `d`, never a pixel under 2pt. */
export function PixelGlyph({ kind, color, d }) {
    const rows = GLYPHS[kind];
    const cols = rows[0].length;
    const px = Math.max(2, Math.floor((d * 0.55) / rows.length));
    return (_jsx(Svg, { width: cols * px, height: rows.length * px, pointerEvents: "none", children: rows.flatMap((row, r) => [...row].map((ch, c) => ch === '#' ? _jsx(Rect, { x: c * px, y: r * px, width: px, height: px, fill: color }, `${r}-${c}`) : null)) }));
}
/** Whether a quick label is the plain add sign the pixel plus replaces. */
export const isPlusLabel = (label) => label === '+' || label === '＋';
