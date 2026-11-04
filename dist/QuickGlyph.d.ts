/**
 * THE QUICK-ADD AS A LITTLE SCREEN (owner, 2026-11-03: "a navy screen texture background, and cyan
 * pixel '+' sign"). With the theme's `quickScreen` on, the pill is drawn like the host's screen
 * panels: its fill (`quickFill`) under a faint grid of `quickText` pixels, and the glyph drawn in
 * square pixels rather than set in a font, so it stays crisp at every pill size.
 */
declare const GLYPHS: {
    readonly plus: readonly ["..#..", "..#..", "#####", "..#..", "..#.."];
    readonly check: readonly [".....#", "....#.", "#..#..", ".##...", "......"];
};
export type QuickGlyphKind = keyof typeof GLYPHS;
/** The screen texture: one faint pixel every 4pt, filling its (rounded, clipped) parent. */
export declare function QuickScreen({ color }: {
    color: string;
}): import("react").JSX.Element;
/** A glyph in square pixels, about 55% of the pill's diameter `d`, never a pixel under 2pt. */
export declare function PixelGlyph({ kind, color, d }: {
    kind: QuickGlyphKind;
    color: string;
    d: number;
}): import("react").JSX.Element;
/** Whether a quick label is the plain add sign the pixel plus replaces. */
export declare const isPlusLabel: (label: unknown) => label is "+" | "＋";
export {};
