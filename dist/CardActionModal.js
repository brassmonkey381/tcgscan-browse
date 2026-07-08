import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { resolveLabel } from './actions';
import { cardThumbUrl } from './config';
import { formatUsd } from './prices';
import { lightTheme } from './theme';
export function CardActionModal({ card, actions, value, onClose, theme = lightTheme }) {
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
    return (_jsx(Modal, { visible: true, transparent: true, animationType: "fade", onRequestClose: onClose, children: _jsx(Pressable, { style: styles.backdrop, onPress: onClose, children: _jsxs(Pressable, { style: styles.sheet, onPress: () => { }, children: [_jsx(View, { style: styles.imageWrap, children: uri ? (_jsx(Image, { source: { uri }, style: styles.image, contentFit: "contain", transition: 120 })) : (_jsx(View, { style: styles.imageFallback, children: _jsx(Text, { style: styles.imageFallbackText, children: "no image" }) })) }), _jsx(Text, { style: styles.name, numberOfLines: 2, children: card.name }), facts.map((f) => (_jsx(Text, { style: styles.fact, numberOfLines: 1, children: f }, f))), _jsxs(View, { style: styles.actions, children: [ordered.map((action) => {
                                const primary = action.kind === 'primary';
                                const destructive = action.kind === 'destructive';
                                return (_jsx(Pressable, { style: [styles.action, primary && styles.actionPrimary], onPress: () => action.onPress(card), children: _jsx(Text, { style: [
                                            styles.actionText,
                                            primary && styles.actionPrimaryText,
                                            destructive && styles.actionDestructiveText,
                                        ], numberOfLines: 1, children: resolveLabel(action, card) }) }, action.key));
                            }), _jsx(Pressable, { style: styles.action, onPress: onClose, children: _jsx(Text, { style: styles.actionCancelText, children: "Cancel" }) })] })] }) }) }));
}
function makeStyles(t) {
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
