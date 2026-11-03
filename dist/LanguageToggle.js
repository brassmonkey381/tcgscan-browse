import { jsx as _jsx } from "react/jsx-runtime";
import { LANGUAGE_ORDER, useBrowseLanguages } from './language';
import { Segmented } from './Segmented';
import { resolveTheme } from './theme';
export function LanguageToggle({ value, onChange, theme, }) {
    const [shared, setShared] = useBrowseLanguages();
    const langs = value ?? shared;
    const set = onChange ?? setShared;
    const t = resolveTheme(theme);
    const choice = langs.length === 1 ? (langs[0] === 'ja' ? 'ja' : 'en') : 'both';
    return (_jsx(Segmented, { theme: t, label: "Card language", value: choice, onChange: (c) => set(c === 'both' ? [...LANGUAGE_ORDER] : [c]), options: [
            { value: 'en', label: 'EN', a11y: 'English cards' },
            { value: 'ja', label: 'JP', a11y: 'Japanese cards' },
            { value: 'both', label: 'EN + JP', a11y: 'English and Japanese cards' },
        ] }));
}
