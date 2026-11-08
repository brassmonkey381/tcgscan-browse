/**
 * A BUTTON GROUP: one rounded tray holding a few options, exactly one of them on (owner,
 * 2026-11-03: "EN/JP need to be in their own button group, where you can only select one at a
 * time ... same with S / M / L"). The shared tray is what says "these belong together, pick one";
 * loose chips side by side read as independent toggles. Used for the language bound and the card
 * size, and for any other pick-one set the kit grows.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { BrowseTheme } from './theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Spoken label, when the visible one is an abbreviation ("S" -> "Small cards"). */
  a11y?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  theme: t,
  label,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Resolved theme. */
  theme: BrowseTheme;
  /** What the group chooses, for a screen reader ("Card language"). */
  label: string;
}) {
  return (
    <View
      role="radiogroup"
      aria-label={label}
      style={[
        styles.tray,
        { backgroundColor: t.panel, borderColor: t.border },
        // The host's lip goes under the whole tray: one piece of hardware, not three.
        t.lip ? { borderBottomWidth: 3, borderBottomColor: t.lip } : null,
      ]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => (on ? undefined : onChange(o.value))}
            role="radio"
            aria-checked={on}
            accessibilityLabel={o.a11y ?? o.label}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [
              styles.seg,
              // A host's touch height (theme.controlHeight): the tray's own padding and border come off it.
              t.controlHeight ? { minHeight: t.controlHeight - 6, justifyContent: 'center', paddingHorizontal: 12, minWidth: 40 } : null,
              on && { backgroundColor: t.accent },
              pressed && !on && styles.pressed,
            ]}>
            <Text selectable={false} style={[styles.text, t.controlHeight ? styles.textTall : null, { color: on ? t.accentText : t.subtext }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tray: { flexDirection: 'row', borderRadius: 999, borderWidth: 1, padding: 2, gap: 2, alignSelf: 'flex-start' },
  // Snug enough that language, size and Sort & filter share one line on a 390pt phone.
  seg: { minWidth: 26, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 999 },
  pressed: { opacity: 0.7 },
  text: { fontSize: 12, fontWeight: '700' },
  textTall: { fontSize: 15 },
});
