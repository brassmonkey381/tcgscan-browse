import type { BrowseTheme } from './theme';
/** WCAG contrast ratio between two #hex colours; null when either is not a #hex colour. */
export declare function contrastRatio(a: string, b: string): number | null;
/**
 * The fill of an ON select pill: the theme's `accent` when `accentText` already reads at 4.5:1 on
 * it (a host whose accent passes keeps it exactly), else a deeper shade of the accent (or a lighter
 * one, when `accentText` is dark) stepped until it does. The default blue maps to #1d4ed8 (6.70:1
 * with white). Colours that are not #hex fall back to the accent unchanged.
 */
export declare function selectFill(t: Pick<BrowseTheme, 'accent' | 'accentText'>): string;
/** ⧉ drawn as two overlapping outlined squares, in `color`. */
export declare function SelectGlyph({ color, size }: {
    color: string;
    size?: number;
}): import("react").JSX.Element;
export interface MultiSelectButtonProps {
    theme: BrowseTheme;
    /** Select mode is on (the solid pill). */
    on: boolean;
    /** How many cards are selected (shown while `on`). */
    count?: number;
    /** Replaces the ON label (the kit passes "Continue with N cards" once 2+ are picked). */
    onLabel?: string;
    /** Replaces the idle label "Select". */
    label?: string;
    disabled?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
}
/** Labels used by the kit's own select control. */
export declare function multiSelectOnLabel(count: number): string;
export declare function MultiSelectButton({ theme: t, on, count, onLabel, label, disabled, onPress, accessibilityLabel, }: MultiSelectButtonProps): import("react").JSX.Element;
/**
 * The pill's metrics. Slim (2px + 1px border around a 16px line, 22px tall) so it sits in the
 * results line without growing it; `hitSlop` 8 keeps the touch area at 38px.
 */
export declare const MULTI_SELECT_PILL: {
    paddingVertical: number;
    paddingHorizontal: number;
    borderWidth: number;
    borderRadius: number;
    gap: number;
    fontSize: number;
    fontWeight: "700";
    lineHeight: number;
    glyphSize: number;
    pressedOpacity: number;
    disabledOpacity: number;
};
