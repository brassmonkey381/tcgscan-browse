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
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CardAction } from './actions';
import { resolveLabel } from './actions';
import type { CatalogCard } from './catalog';
import { cardThumbUrl } from './config';
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
  // 640px webp (inspection tier), resolved by id via the image manifest.
  const uri = cardThumbUrl(card.id, 640);
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
          {card.imageSubstituted ? (
            <Text style={styles.caveat}>
              This image may differ slightly from the real card — it could carry a stamp,
              overlay, or signature we missed.
            </Text>
          ) : null}

          <View style={styles.actions}>
            {ordered.map((action) => {
              const primary = action.kind === 'primary';
              const destructive = action.kind === 'destructive';
              return (
                <Pressable
                  key={action.key}
                  style={[styles.action, primary && styles.actionPrimary]}
                  // Dismiss the sheet on any choice, THEN run the action — so
                  // "View details" doesn't leave the sheet over the card screen
                  // and "Add to collection" doesn't stack under it. (Built-ins
                  // also self-close; the extra close is idempotent.)
                  onPress={() => {
                    onClose();
                    action.onPress(card);
                  }}>
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

/**
 * Multi-select action sheet — shown when 2+ cards are selected (Ctrl/Shift-click on web).
 * The image area crams every selected thumb into the usual footprint (scrolls if they
 * overflow), then offers the batch actions. Buttons are hidden when their handler is absent
 * (e.g. no "Find similar to all" when the data server isn't configured).
 */
export function MultiCardActionModal({
  cards,
  onAddAll,
  onFindSimilarAll,
  onClose,
  theme = lightTheme,
}: {
  cards: CatalogCard[];
  /** "Add all to a binder" (app-supplied). Omit to hide the button. */
  onAddAll?: () => void;
  /** "Find similar to all" (kit-supplied embedding search). Omit to hide the button. */
  onFindSimilarAll?: () => void;
  onClose: () => void;
  theme?: BrowseTheme;
}) {
  const styles = makeStyles(theme);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.imageWrap}>
            <ScrollView contentContainerStyle={styles.multiGrid}>
              {cards.map((c) => {
                const uri = cardThumbUrl(c.id, 245);
                return (
                  <View key={c.id} style={styles.multiThumb}>
                    {uri ? (
                      <Image source={{ uri }} style={styles.image} contentFit="contain" transition={80} />
                    ) : (
                      <View style={styles.imageFallback}>
                        <Text style={styles.imageFallbackText}>—</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {cards.length} cards selected
          </Text>

          <View style={styles.actions}>
            {onAddAll ? (
              <Pressable
                style={[styles.action, styles.actionPrimary]}
                onPress={() => {
                  onClose();
                  onAddAll();
                }}>
                <Text style={[styles.actionText, styles.actionPrimaryText]} numberOfLines={1}>
                  Add all to a binder
                </Text>
              </Pressable>
            ) : null}
            {onFindSimilarAll ? (
              <Pressable
                style={styles.action}
                onPress={() => {
                  onClose();
                  onFindSimilarAll();
                }}>
                <Text style={styles.actionText} numberOfLines={1}>
                  ≈ Find similar to all
                </Text>
              </Pressable>
            ) : null}
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
    // Multi-select: cram the selected thumbs into the image footprint, wrapping + scrolling.
    multiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 6, justifyContent: 'center' },
    multiThumb: { width: 52, aspectRatio: 63 / 88, borderRadius: 6, overflow: 'hidden', backgroundColor: t.imagePlaceholder },
    imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    imageFallbackText: { color: t.faint, fontSize: 12 },
    name: { fontSize: 16, fontWeight: '700', color: t.text },
    fact: { fontSize: 12, color: t.subtext },
    caveat: { fontSize: 11, color: t.faint, fontStyle: 'italic', marginTop: 4, lineHeight: 15 },
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
