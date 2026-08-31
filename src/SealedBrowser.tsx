/**
 * The sealed-product catalog, browsable: booster boxes, ETBs, tins, bundles — priced.
 *
 * DELIBERATELY NOT CatalogBrowser, and not a tab inside it. Cards need a series → set → card
 * drill-down, a server search, the query grammar and a warm/cold catalog split because there are
 * hundreds of thousands of them. Sealed is ~3k products that arrive as ONE public JSON (see
 * sealed.ts) with no catalog dependency and no cold path, so a flat client-filtered grid is the
 * honest shape — and bending the card browser around a second catalog shape would buy nothing.
 *
 * THE HOST DECIDES WHO SEES IT, by importing it or not. This is the kit's existing way of having
 * a surface one app shows and the other does not — RecentProducts is michi's and tcgscan-app
 * mounts it nowhere; this is the mirror image. No flag, no lock, no platform sniff: a
 * BrowseFeature would be wrong by construction (that union is the TIER seam, and a locked
 * feature is meant to stay VISIBLE and advertise a plan), and a runtime app check is forbidden
 * outright.
 *
 * Search stays a substring over name + series rather than the kit's query grammar. The grammar
 * assumes a card — half its vocabulary (artist:, rarity:, hp>N, sort:stage) would match zero
 * sealed rows without saying so, and its name-word heuristic actively suppresses set matches for
 * a word that hits several card names, which is most of what a sealed product is called. Adopting
 * it means an adapter, a sealed manual, and an unsupported-field notice — a separate piece of
 * work, not a promotion.
 */
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LanguageToggle } from './LanguageToggle';
import type { CardLanguage } from './catalog';
import { useBrowseLanguages } from './language';
import { formatUsd } from './prices';
import { SEALED_GROUPS, sealedGroupOf, type SealedGroup } from './sealed-groups';
import { sealedLanguageOf, useSealed, type SealedProduct } from './sealed';
import { resolveTheme, tileShadow, type BrowseTheme } from './theme';

export function SealedBrowser({
  theme: themeProp,
  languages,
  numColumns = 2,
  onOpen,
  onAdd,
  addLabel = '＋',
}: {
  theme?: Partial<BrowseTheme>;
  /**
   * PIN this surface to specific printings. Omit to follow the shared browse preference, which is
   * what makes the sealed shelf agree with the card shelf beside it; when pinned, the toggle is
   * hidden because the host has already decided.
   */
  languages?: CardLanguage[];
  /** Grid width. Two suits a phone; a desktop host can ask for more. */
  numColumns?: number;
  /** Open a product. Omitted → tiles are not pressable. */
  onOpen?: (product: SealedProduct) => void;
  /** The corner quick-add. Omitted → no pill, the same way every app-shaped affordance here works. */
  onAdd?: (product: SealedProduct) => void;
  /** Glyph for that pill, if a host wants words instead. */
  addLabel?: string;
}) {
  const theme = useMemo(() => resolveTheme(themeProp), [themeProp]);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { sealed, priceOf, status } = useSealed();
  const [shared] = useBrowseLanguages();
  const langs = languages ?? shared;
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<SealedGroup | 'all'>('all');

  const wanted = useMemo(
    () => new Set(langs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity churns; the contents do not
    [langs.join(',')],
  );

  const shown = useMemo(() => {
    if (!sealed) return [];
    const q = query.trim().toLowerCase();
    return sealed
      .newestFirst()
      .filter((p) => wanted.has(sealedLanguageOf(p)))
      .filter((p) => group === 'all' || sealedGroupOf(p.name) === group)
      .filter((p) => !q || `${p.name} ${p.series}`.toLowerCase().includes(q));
  }, [sealed, query, group, wanted]);

  if (status !== 'ready') {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {status === 'error'
            ? 'Sealed products aren’t available right now.'
            : 'Loading sealed products…'}
        </Text>
      </View>
    );
  }

  const searching = query.trim().length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.controls}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search sealed products…"
          placeholderTextColor={theme.faint}
          autoCorrect={false}
          autoCapitalize="none"
          style={styles.search}
        />
        {/* The kit's own pills, bound to the SHARED preference — so choosing English on the card
            shelf means English here too. A second, private language control on the same screen is
            exactly the bolt-on this promotion removes. Hidden when the host pins `languages`. */}
        {languages ? null : <LanguageToggle theme={themeProp} />}
        {/* WHAT KIND OF THING: the groups collectors shop by, derived from product names
            (sealed-groups). Horizontal because eight chips wrap into a wall on a phone. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {[{ key: 'all' as const, label: 'Everything' }, ...SEALED_GROUPS].map((g) => (
            <Pressable
              key={g.key}
              onPress={() => setGroup(g.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: group === g.key }}
              style={[styles.chip, group === g.key && styles.chipOn]}>
              <Text style={styles.chipText}>{g.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {shown.length === 0 ? (
        <View style={styles.empty}>
          {/* Two different emptinesses, said apart: a search that found nothing names what was
              typed, while a filter that empties the grid must not quote an empty box back. */}
          <Text style={styles.emptyText}>
            {searching ? `Nothing matches “${query.trim()}”.` : 'No sealed products here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          numColumns={numColumns}
          key={numColumns} /* FlatList cannot change column count in place */
          columnWrapperStyle={numColumns > 1 ? styles.row : undefined}
          contentContainerStyle={styles.grid}
          renderItem={({ item: p }) => {
            const price = formatUsd(priceOf(p.id));
            return (
              <Pressable
                style={styles.tile}
                accessibilityRole={onOpen ? 'button' : undefined}
                accessibilityLabel={p.name}
                disabled={!onOpen}
                onPress={onOpen ? () => onOpen(p) : undefined}>
                {/* Sealed rows carry their own tiered image URLs — no manifest, no tier march. */}
                <Image
                  source={{ uri: p.imageSmall || p.image }}
                  style={styles.art}
                  contentFit="contain"
                  transition={100}
                />
                <Text style={styles.name} numberOfLines={2}>
                  {p.name}
                </Text>
                <View style={styles.tileFoot}>
                  <Text style={styles.price}>{price}</Text>
                  {onAdd ? (
                    <Pressable
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${p.name}`}
                      onPress={() => onAdd(p)}>
                      <Text style={styles.add}>{addLabel}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function makeStyles(t: BrowseTheme) {
  return StyleSheet.create({
    wrap: { flex: 1 },
    controls: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
    search: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.panel,
      color: t.text,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    chipRow: { flexDirection: 'row', gap: 8 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.panel,
    },
    chipOn: { backgroundColor: t.selected, borderColor: t.accent },
    chipText: { color: t.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
    grid: { padding: 12, gap: 8 },
    row: { gap: 8 },
    tile: {
      flex: 1,
      borderRadius: 12,
      padding: 10,
      gap: 6,
      backgroundColor: t.panel,
      borderWidth: 1,
      borderColor: t.border,
      ...tileShadow,
    },
    art: { width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: t.imagePlaceholder },
    name: { color: t.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
    tileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    price: { color: t.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
    add: { color: t.link, fontSize: 16, lineHeight: 22, fontWeight: '700' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyText: { color: t.subtext, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  });
}
