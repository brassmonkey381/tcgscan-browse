import type { CardLanguage } from './catalog';
import { type BrowseTheme } from './theme';
export declare function LanguageToggle({ value, onChange, theme, }: {
    /** Controlled value. Omit to bind to the shared preference. */
    value?: CardLanguage[];
    /** Controlled setter. Omit to write to the shared preference. */
    onChange?: (langs: CardLanguage[]) => void;
    theme?: Partial<BrowseTheme>;
}): import("react").JSX.Element;
