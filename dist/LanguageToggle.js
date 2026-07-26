import { jsx as _jsx } from "react/jsx-runtime";
/**
 * EN / JP printing-language toggle — the kit-owned control for the shared language preference.
 *
 * Two pills, multi-select: either or both can be on, and at least one always stays selected
 * (toggling off the last one is a no-op) so a browse surface is never constrained to nothing.
 *
 * By default it drives the SHARED preference (`useBrowseLanguages`), which is what makes the
 * choice apply BEFORE every search the kit runs — query search, the series/set drill-down, the
 * recent feed, embedding similarity, and the colour searches all read the same value and pass it
 * to the server. Place it wherever the app's layout wants; there is only one value behind it.
 *
 * Pass `value`/`onChange` to drive it from app-owned state instead (the controlled form).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGE_ORDER, languageLabel, languageShortLabel, useBrowseLanguages } from './language';
import { resolveTheme } from './theme';
export function LanguageToggle({ value, onChange, theme, }) {
    const [shared, setShared] = useBrowseLanguages();
    const langs = value ?? shared;
    const set = onChange ?? setShared;
    const t = resolveTheme(theme);
    const toggle = (code) => {
        const on = langs.includes(code);
        if (on && langs.length === 1)
            return; // keep at least one language selected
        // Re-derive in canonical order so the value is stable regardless of tap order.
        set(LANGUAGE_ORDER.filter((c) => (c === code ? !on : langs.includes(c))));
    };
    return (_jsx(View, { style: styles.row, children: LANGUAGE_ORDER.map((code) => {
            const active = langs.includes(code);
            return (_jsx(Pressable, { onPress: () => toggle(code), accessibilityRole: "button", accessibilityState: { selected: active }, accessibilityLabel: `Show ${languageLabel(code)} cards`, style: ({ pressed }) => [
                    styles.btn,
                    { backgroundColor: active ? t.accent : t.panel, borderColor: t.border },
                    pressed && styles.pressed,
                ], children: _jsx(Text, { style: [styles.txt, { color: active ? t.accentText : t.subtext }], children: languageShortLabel(code) }) }, code));
        }) }));
}
const styles = StyleSheet.create({
    row: { flexDirection: 'row', gap: 4 },
    btn: {
        paddingVertical: 5,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: StyleSheet.hairlineWidth,
    },
    pressed: { opacity: 0.7 },
    txt: { fontSize: 12, fontWeight: '600' },
});
