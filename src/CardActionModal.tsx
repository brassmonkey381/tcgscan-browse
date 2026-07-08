/**
 * Card action sheet — what tapping a card in the browser opens. It is a DUMB
 * RENDERER over the resolved `CardAction[]` the app supplies: it shows the card at
 * inspection size with its facts + value, then the actions (primary first, then the
 * rest, then Cancel). It no longer knows about pockets or any app's verbs.
 *
 * Inspection image uses `imageMedium ?? image` (the 640px webp): the full-size
 * `card-imgs/*.jpg` 400s on the migrated tcgscan-data backend (content-hashed webp
 * only), so the sheet image would otherwise fail to load.
 */
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CardAction } from './actions';
import { resolveLabel } from './actions';
import type { CatalogCard } from './catalog';
import { resolveImageUrl } from './config';
import { formatUsd } from './prices';
import { lightTheme, type BrowseTheme } from './theme';

interface CardActionModalProps {
  card: CatalogCard;
  /** Resolved actions (already filtered by `available`), in app-supplied order. */
  actions: CardAction[];
  /** Headline value, 0 when unpriced. */
  value: number;
  onClose: () => void;
  theme?: BrowseTheme;
}

export function CardActionModal({ card, actions, value, onClose, theme = lightTheme }: CardActionModalProps) {
  const styles = makeStyles(theme);
  // 640px webp — the full-size jpg 400s on the migrated backend.
  const uri = resolveImageUrl(card.imageMedium ?? card.image);
  const facts = [
    [card.setName, card.number].filter(Boolean).join(' · '),
    [card.rarity, card.stage].filter(Boolean).join(' · '),
    card.illustrator ? `Illus. ${card.illustrator}` : '',
    value > 0 ? `Value ${formatUsd(value)}` : '',
  ].filter(Boolean);

  // Primary first, then the rest — order within each group preserved.
  const ordered = [...actions].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* stopPropagation wrapper so taps inside the sheet don't dismiss */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.imageWrap}>
            {uri ? (
              <Image source={{ uri }} style={styles.image} contentFit="contain" transition={120} />
            ) : (
              <View style={styles.imageFallback}>
                <Text style={styles.imageFallbackText}>no image</Text>
              </View>
            )}
          </View>
          <Text style={styles.name} numberOfLines={2}>
            {card.name}
          </Text>
          {facts.map((f) => (
            <Text key={f} style={styles.fact} numberOfLines={1}>
              {f}
            </Text>
          ))}

          <View style={styles.actions}>
            {ordered.map((action) => {
              const primary = action.kind === 'primary';
              const destructive = action.kind === 'destructive';
              return (
                <Pressable
                  key={action.key}
                  style={[styles.action, primary && styles.actionPrimary]}
                  onPress={() => action.onPress(card)}>
                  <Text
                    style={[
                      styles.actionText,
                      primary && styles.actionPrimaryText,
                      destructive && styles.actionDestructiveText,
                    ]}
                    numberOfLines={1}>
                    {resolveLabel(action, card)}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable style={styles.action} onPress={onClose}>
              <Text style={styles.actionCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(t: BrowseTheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: t.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 340,
      borderRadius: 14,
      backgroundColor: t.background,
      padding: 14,
      gap: 4,
    },
    imageWrap: {
      width: '100%',
      aspectRatio: 63 / 88,
      maxHeight: 340,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: t.imagePlaceholder,
      marginBottom: 6,
    },
    image: { width: '100%', height: '100%' },
    imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    imageFallbackText: { color: t.faint, fontSize: 12 },
    name: { fontSize: 16, fontWeight: '700', color: t.text },
    fact: { fontSize: 12, color: t.subtext },
    actions: { marginTop: 10, gap: 6 },
    action: {
      borderRadius: 9,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
    },
    actionPrimary: { backgroundColor: t.accent, borderColor: t.accent },
    actionText: { color: t.link, fontSize: 14, fontWeight: '600' },
    actionPrimaryText: { color: t.accentText, fontWeight: '700' },
    actionDestructiveText: { color: t.danger },
    actionCancelText: { color: t.subtext, fontSize: 13, fontWeight: '600' },
  });
}
