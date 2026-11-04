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
} as const;

export type QuickGlyphKind = keyof typeof GLYPHS;

/** The screen texture: one faint pixel every 4pt, filling its (rounded, clipped) parent. */
export function QuickScreen({ color }: { color: string }) {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern id="kit-quick-screen" width={4} height={4} patternUnits="userSpaceOnUse">
          <Rect x={1} y={1} width={2} height={2} fill={color} opacity={0.12} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#kit-quick-screen)" />
    </Svg>
  );
}

/** A glyph in square pixels, about 55% of the pill's diameter `d`, never a pixel under 2pt. */
export function PixelGlyph({ kind, color, d }: { kind: QuickGlyphKind; color: string; d: number }) {
  const rows = GLYPHS[kind];
  const cols = rows[0].length;
  const px = Math.max(2, Math.floor((d * 0.55) / rows.length));
  return (
    <Svg width={cols * px} height={rows.length * px} pointerEvents="none">
      {rows.flatMap((row, r) =>
        [...row].map((ch, c) =>
          ch === '#' ? <Rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={color} /> : null,
        ),
      )}
    </Svg>
  );
}

/** Whether a quick label is the plain add sign the pixel plus replaces. */
export const isPlusLabel = (label: unknown) => label === '+' || label === '＋';
