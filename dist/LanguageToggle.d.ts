/**
 * EN / JP / EN + JP printing-language control: the kit-owned control for the shared language
 * preference.
 *
 * A button group, pick one (owner, 2026-11-03). It used to be two pills that toggled
 * independently, where "both" meant both pills lit; that read as two filters rather than one
 * choice, so "both" is now an option of its own. The value behind it is unchanged: a list of
 * languages, never empty, so a browse surface is never constrained to nothing.
 *
 * By default it drives the SHARED preference (`useBrowseLanguages`), which is what makes the
 * choice apply BEFORE every search the kit runs — query search, the series/set drill-down, the
 * recent feed, embedding similarity, and the colour searches all read the same value and pass it
 * to the server. Place it wherever the app's layout wants; there is only one value behind it.
 *
 * Pass `value`/`onChange` to drive it from app-owned state instead (the controlled form).
 */
import type { CardLanguage } from './catalog';
import { type BrowseTheme } from './theme';
export declare function LanguageToggle({ value, onChange, theme, }: {
    /** Controlled value. Omit to bind to the shared preference. */
    value?: CardLanguage[];
    /** Controlled setter. Omit to write to the shared preference. */
    onChange?: (langs: CardLanguage[]) => void;
    theme?: Partial<BrowseTheme>;
}): import("react").JSX.Element;
