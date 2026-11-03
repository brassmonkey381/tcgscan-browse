import { jsx as _jsx } from "react/jsx-runtime";
/**
 * A BUTTON GROUP: one rounded tray holding a few options, exactly one of them on (owner,
 * 2026-11-03: "EN/JP need to be in their own button group, where you can only select one at a
 * time ... same with S / M / L"). The shared tray is what says "these belong together, pick one";
 * loose chips side by side read as independent toggles. Used for the language bound and the card
 * size, and for any other pick-one set the kit grows.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
export function Segmented({ options, value, onChange, theme: t, label, }) {
    return (_jsx(View, { role: "radiogroup", "aria-label": label, style: [
            styles.tray,
            { backgroundColor: t.panel, borderColor: t.border },
            // The host's lip goes under the whole tray: one piece of hardware, not three.
            t.lip ? { borderBottomWidth: 3, borderBottomColor: t.lip } : null,
        ], children: options.map((o) => {
            const on = o.value === value;
            return (_jsx(Pressable, { onPress: () => (on ? undefined : onChange(o.value)), role: "radio", "aria-checked": on, accessibilityLabel: o.a11y ?? o.label, hitSlop: { top: 6, bottom: 6 }, style: ({ pressed }) => [styles.seg, on && { backgroundColor: t.accent }, pressed && !on && styles.pressed], children: _jsx(Text, { selectable: false, style: [styles.text, { color: on ? t.accentText : t.subtext }], numberOfLines: 1, children: o.label }) }, o.value));
        }) }));
}
const styles = StyleSheet.create({
    tray: { flexDirection: 'row', borderRadius: 999, borderWidth: 1, padding: 2, gap: 2, alignSelf: 'flex-start' },
    // Snug enough that language, size and Sort & filter share one line on a 390pt phone.
    seg: { minWidth: 26, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999 },
    pressed: { opacity: 0.7 },
    text: { fontSize: 12, fontWeight: '700' },
});
