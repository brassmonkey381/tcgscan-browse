import type { BrowseTheme } from './theme';
export interface SegmentOption<T extends string> {
    value: T;
    label: string;
    /** Spoken label, when the visible one is an abbreviation ("S" -> "Small cards"). */
    a11y?: string;
}
export declare function Segmented<T extends string>({ options, value, onChange, theme: t, label, }: {
    options: SegmentOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Resolved theme. */
    theme: BrowseTheme;
    /** What the group chooses, for a screen reader ("Card language"). */
    label: string;
}): import("react").JSX.Element;
