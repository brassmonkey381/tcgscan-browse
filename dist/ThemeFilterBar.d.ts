import type { ThemeFacetCounts, ThemeFrame } from './search';
import type { BrowseTheme } from './theme';
/** One registry type group: its key (what `p_types` and `type_group` carry), label and colour. */
export interface ThemeTypeGroup {
    key: string;
    label: string;
    color: string;
}
export interface ThemeFilterBarProps {
    theme: BrowseTheme;
    frame: ThemeFrame;
    onPickFrame: (frame: ThemeFrame) => void;
    /** The registry's type groups, in display order. Empty or absent: no chips and no Group switch. */
    typeGroups?: readonly ThemeTypeGroup[];
    /** What a type is called in this game ("Ink", "Color"); defaults to "type". */
    typeLabel?: string;
    /** The selected group keys. */
    types: readonly string[];
    onToggleType: (key: string) => void;
    onClearTypes: () => void;
    group: boolean;
    onToggleGroup: () => void;
    /** `theme_facets` for the current query; null when it failed (counts hidden, chips kept). */
    counts: ThemeFacetCounts | null;
    /** Phone width: the type chips fold into one dropdown and the segment drops its counts. */
    compact?: boolean;
}
export declare function ThemeFilterBar({ theme, frame, onPickFrame, typeGroups, typeLabel, types, onToggleType, onClearTypes, group, onToggleGroup, counts, compact, }: ThemeFilterBarProps): import("react").JSX.Element;
