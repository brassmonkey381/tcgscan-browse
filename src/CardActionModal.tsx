/**
 * Card action sheet — what tapping a card in the browser opens, instead of
 * silently placing it into the pocket (which replaces the occupant with no
 * warning). Shows the card at inspection size (full-resolution image, per the
 * tier mapping: grids 245px / binder pages 640px / inspection full) with its
 * facts + value, and the actions:
 *   - Place in pocket / Replace “<occupant>” (the explicit, informed version
 *     of the old default)
 *   - ≈ Find similar (embedding search on the data server)
 *   - View set (jump the browser's drill-down to the card's set)
 */
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CatalogCard } from './catalog';
import { resolveImageUrl } from './config';
import { formatUsd } from './prices';

interface CardActionModalProps {
  card: CatalogCard;
  /** Current pocket occupant (if any) — turns "Place" into an explicit "Replace". */
  occupant?: CatalogCard;
  /** Headline value, 0 when unpriced. */
  value: number;
  onPlace: () => void;
  onSimilar?: () => void;
  onViewSet?: () => void;
  onClose: () => void;
}

export function CardActionModal({
  card,
  occupant,
  value,
  onPlace,
  onSimilar,
  onViewSet,
  onClose,
}: CardActionModalProps) {
  const uri = resolveImageUrl(card.image);
  const facts = [
    [card.setName, card.number].filter(Boolean).join(' · '),
    [card.rarity, card.stage].filter(Boolean).join(' · '),
    card.illustrator ? `Illus. ${card.illustrator}` : '',
    value > 0 ? `Value ${formatUsd(value)}` : '',
  ].filter(Boolean);
  const replacing = occupant && occupant.id !== card.id;

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
            <Pressable style={[styles.action, styles.actionPrimary]} onPress={onPlace}>
              <Text style={styles.actionPrimaryText} numberOfLines={1}>
                {replacing ? `Replace “${occupant.name}”` : 'Place in pocket'}
              </Text>
            </Pressable>
            {onSimilar ? (
              <Pressable style={styles.action} onPress={onSimilar}>
                <Text style={styles.actionText}>≈ Find similar</Text>
              </Pressable>
            ) : null}
            {onViewSet ? (
              <Pressable style={styles.action} onPress={onViewSet}>
                <Text style={styles.actionText}>View set</Text>
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,14,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 14,
    gap: 4,
  },
  imageWrap: {
    width: '100%',
    aspectRatio: 63 / 88,
    maxHeight: 340,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f0f0f3',
    marginBottom: 6,
  },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageFallbackText: { color: '#b0b0b8', fontSize: 12 },
  name: { fontSize: 16, fontWeight: '700', color: '#222' },
  fact: { fontSize: 12, color: '#777' },
  actions: { marginTop: 10, gap: 6 },
  action: {
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e2e2e6',
    alignItems: 'center',
  },
  actionPrimary: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  actionPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  actionText: { color: '#2a5db0', fontSize: 14, fontWeight: '600' },
  actionCancelText: { color: '#888', fontSize: 13, fontWeight: '600' },
});
