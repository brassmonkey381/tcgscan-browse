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
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { resolveLabel } from './actions';
import { evolutionNeighbors } from './catalog';
import { cardThumbUrl } from './config';
import { formatUsd } from './prices';
import { fetchCardDetail } from './search';
import { lightTheme } from './theme';
/**
 * THE INSPECTION IMAGE IS AT LEAST AS BIG AS AN "L" GRID TILE. The sheet used to cap the image at
 * 340px tall, which on a 63:88 card is 243px wide: smaller than the tiles it was opened from at
 * the L size, so "look closer" showed less. The cap now follows the viewport instead (most of
 * its height, so the facts and actions below still fit without the sheet scrolling on a laptop),
 * and the sheet is wide enough for the 640px inspection tier to be worth loading.
 */
const SHEET_MAX_WIDTH = 460;
const IMAGE_VIEWPORT_FRACTION = 0.6;
const IMAGE_MAX_HEIGHT = 640;
/** The backdrop's padding, top and bottom: the sheet never grows past the screen less this. */
const SHEET_MARGIN = 40;
export function CardActionModal(props) {
    const theme = props.theme ?? lightTheme;
    if (theme.popup)
        return _jsx(PopupCardView, { ...props, theme: theme, skin: theme.popup });
    return _jsx(PlainCardView, { ...props, theme: theme });
}
function PlainCardView({ card, actions, value, onClose, theme = lightTheme }) {
    const styles = makeStyles(theme);
    const { height: windowHeight } = useWindowDimensions();
    const imageMaxHeight = Math.min(IMAGE_MAX_HEIGHT, Math.round(windowHeight * IMAGE_VIEWPORT_FRACTION));
    // 640px webp (inspection tier), resolved by id via the image manifest.
    const uri = cardThumbUrl(card.id, 640);
    const facts = [
        [card.setName, card.number].filter(Boolean).join(' · '),
        [card.rarity, card.stage].filter(Boolean).join(' · '),
        card.illustrator ? `Illus. ${card.illustrator}` : '',
        value > 0 ? `Value ${formatUsd(value)}` : '',
    ].filter(Boolean);
    // Evolution neighbours (from the authoritative evolves_from + the ordered evolution line).
    // The slim catalog no longer ships evolution_line (P4 lazy-load) — when the card arrives
    // without one, fetch it per card on open (rpc/card_detail, cached in the search module).
    const [detail, setDetail] = useState(null);
    useEffect(() => {
        setDetail(null);
        if (card.evolutionLine.length > 0)
            return;
        let stale = false;
        fetchCardDetail([card.id]).then((d) => {
            if (!stale && d[card.id])
                setDetail(d[card.id]);
        });
        return () => {
            stale = true;
        };
    }, [card.id, card.evolutionLine.length]);
    const evo = evolutionNeighbors(detail
        ? { ...card, evolvesFrom: card.evolvesFrom || detail.evolvesFrom, evolutionLine: detail.evolutionLine }
        : card);
    const evoLine = [
        evo.from ? `↑ Evolves from ${evo.from}` : '',
        evo.to ? `↓ Evolves to ${evo.to}` : '',
    ]
        .filter(Boolean)
        .join('   ');
    // Primary first, then the rest — order within each group preserved.
    const ordered = [...actions].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
    return (_jsx(Modal, { visible: true, transparent: true, animationType: "fade", onRequestClose: onClose, children: _jsxs(View, { style: styles.backdrop, children: [_jsx(Pressable, { style: StyleSheet.absoluteFill, onPress: onClose, accessibilityLabel: "Close" }), _jsx(View, { style: [styles.sheet, { maxHeight: windowHeight - SHEET_MARGIN }], children: _jsxs(ScrollView, { style: { overscrollBehavior: 'contain' }, contentContainerStyle: styles.sheetBody, bounces: false, alwaysBounceVertical: false, overScrollMode: "never", nestedScrollEnabled: true, children: [_jsx(View, { style: [styles.imageWrap, { maxHeight: imageMaxHeight }], children: uri ? (_jsx(Image, { source: { uri }, style: styles.image, contentFit: "contain", transition: 120 })) : theme.comingSoonImage ? (_jsx(Image, { source: theme.comingSoonImage, style: styles.image, contentFit: "contain", transition: 120, accessibilityLabel: "Image coming soon" })) : (_jsx(View, { style: styles.imageFallback, children: _jsx(Text, { style: styles.imageFallbackText, children: "no image" }) })) }), _jsx(Text, { style: styles.name, numberOfLines: 2, children: card.name }), facts.map((f) => (_jsx(Text, { style: styles.fact, numberOfLines: 1, children: f }, f))), evoLine ? (_jsx(Text, { style: styles.evo, numberOfLines: 1, children: evoLine })) : null, card.imageSubstituted ? (_jsx(Text, { style: styles.caveat, children: "This image may differ slightly from the real card, it could carry a stamp, overlay, or signature we missed." })) : null, _jsxs(View, { style: styles.actions, children: [ordered.map((action) => {
                                        const primary = action.kind === 'primary';
                                        const destructive = action.kind === 'destructive';
                                        return (_jsx(Pressable, { style: [styles.action, primary && styles.actionPrimary], 
                                            // Dismiss the sheet on any choice, THEN run the action — so
                                            // "View details" doesn't leave the sheet over the card screen
                                            // and "Add to collection" doesn't stack under it. (Built-ins
                                            // also self-close; the extra close is idempotent.)
                                            onPress: () => {
                                                onClose();
                                                action.onPress(card);
                                            }, children: _jsx(Text, { style: [
                                                    styles.actionText,
                                                    primary && styles.actionPrimaryText,
                                                    destructive && styles.actionDestructiveText,
                                                ], numberOfLines: 1, children: resolveLabel(action, card) }) }, action.key));
                                    }), _jsx(Pressable, { style: styles.action, onPress: onClose, children: _jsx(Text, { style: styles.actionCancelText, children: "Cancel" }) })] })] }) })] }) }));
}
/**
 * Multi-select action sheet — shown when 2+ cards are selected (Ctrl/Shift-click on web).
 * The image area crams every selected thumb into the usual footprint (scrolls if they
 * overflow), then offers the batch actions. Buttons are hidden when their handler is absent
 * (e.g. no "Find similar to all" when the data server isn't configured).
 */
export function MultiCardActionModal({ cards, onAddAll, addAllLabel = 'Add all to a binder', onFindSimilarAll, onMoreLikeAll, onLessLikeAll, onClose, theme = lightTheme, }) {
    const styles = makeStyles(theme);
    const { height: windowHeight } = useWindowDimensions();
    const imageMaxHeight = Math.min(IMAGE_MAX_HEIGHT, Math.round(windowHeight * IMAGE_VIEWPORT_FRACTION));
    return (_jsx(Modal, { visible: true, transparent: true, animationType: "fade", onRequestClose: onClose, children: _jsxs(View, { style: styles.backdrop, children: [_jsx(Pressable, { style: StyleSheet.absoluteFill, onPress: onClose, accessibilityLabel: "Close" }), _jsx(View, { style: [styles.sheet, { maxHeight: windowHeight - SHEET_MARGIN }], children: _jsxs(ScrollView, { style: { overscrollBehavior: 'contain' }, contentContainerStyle: styles.sheetBody, bounces: false, alwaysBounceVertical: false, overScrollMode: "never", nestedScrollEnabled: true, children: [_jsx(View, { style: [styles.imageWrap, { maxHeight: imageMaxHeight }], children: _jsx(ScrollView, { contentContainerStyle: styles.multiGrid, children: cards.map((c) => {
                                        const uri = cardThumbUrl(c.id, 245);
                                        return (_jsx(View, { style: styles.multiThumb, children: uri ? (_jsx(Image, { source: { uri }, style: styles.image, contentFit: "contain", transition: 80 })) : (_jsx(View, { style: styles.imageFallback, children: _jsx(Text, { style: styles.imageFallbackText, children: "\u2014" }) })) }, c.id));
                                    }) }) }), _jsxs(Text, { style: styles.name, numberOfLines: 1, children: [cards.length, " cards selected"] }), _jsxs(View, { style: styles.actions, children: [onAddAll ? (_jsx(Pressable, { style: [styles.action, styles.actionPrimary], onPress: () => {
                                            onClose();
                                            onAddAll();
                                        }, children: _jsx(Text, { style: [styles.actionText, styles.actionPrimaryText], numberOfLines: 1, children: addAllLabel }) })) : null, onMoreLikeAll ? (_jsx(Pressable, { style: styles.action, onPress: () => {
                                            onClose();
                                            onMoreLikeAll();
                                        }, children: _jsx(Text, { style: styles.actionText, numberOfLines: 1, children: "\u2295 More like these" }) })) : null, onLessLikeAll ? (_jsx(Pressable, { style: styles.action, onPress: () => {
                                            onClose();
                                            onLessLikeAll();
                                        }, children: _jsx(Text, { style: styles.actionText, numberOfLines: 1, children: "\u2296 Less like these" }) })) : null, onFindSimilarAll ? (_jsx(Pressable, { style: styles.action, onPress: () => {
                                            onClose();
                                            onFindSimilarAll();
                                        }, children: _jsx(Text, { style: styles.actionText, numberOfLines: 1, children: "\u2248 Find similar to all" }) })) : null, _jsx(Pressable, { style: styles.action, onPress: onClose, children: _jsx(Text, { style: styles.actionCancelText, children: "Cancel" }) })] })] }) })] }) }));
}
/** At this window width and up the popup quick view lays the art beside the facts. */
const POPUP_WIDE_AT = 760;
const POPUP_MAX_WIDTH_WIDE = 900;
/**
 * THE QUICK VIEW IN THE HOST'S POP-UP SKIN (v0.9.65, tcgscan-app TCG-029 R03, owner approved
 * 2026-11-16). Drawn only when the theme carries `popup`; without it the sheet above draws exactly
 * as before, so michi-maker is unchanged.
 *
 * One primary action as the big button (the app's `primary`), the next as its partner, the rest in
 * a compact row; the price in the host's price chip; the host's own facts ("You own 0 copies")
 * under the kit's; a close X; and, when the browser passes neighbours, arrows (and the left/right
 * keys on the web) that step through the grid without closing.
 */
function PopupCardView({ card, actions, value, onClose, theme, skin, facts: hostFacts, onPrev, onNext, }) {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const wide = windowWidth >= POPUP_WIDE_AT;
    const styles = makePopupStyles(skin, wide);
    const uri = cardThumbUrl(card.id, 640);
    // Left/right keys step through the grid on the web, while the pop-up is open.
    useEffect(() => {
        if (Platform.OS !== 'web' || (!onPrev && !onNext))
            return;
        const onKey = (e) => {
            if (e.key === 'ArrowLeft' && onPrev) {
                e.preventDefault();
                onPrev();
            }
            else if (e.key === 'ArrowRight' && onNext) {
                e.preventDefault();
                onNext();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onPrev, onNext]);
    const [detail, setDetail] = useState(null);
    useEffect(() => {
        setDetail(null);
        if (card.evolutionLine.length > 0)
            return;
        let stale = false;
        fetchCardDetail([card.id]).then((d) => {
            if (!stale && d[card.id])
                setDetail(d[card.id]);
        });
        return () => {
            stale = true;
        };
    }, [card.id, card.evolutionLine.length]);
    const evo = evolutionNeighbors(detail ? { ...card, evolvesFrom: card.evolvesFrom || detail.evolvesFrom, evolutionLine: detail.evolutionLine } : card);
    const tags = [card.rarity, card.stage].filter(Boolean);
    const rows = [
        ...(card.illustrator ? [{ label: 'Illustrator', value: card.illustrator }] : []),
        ...(evo.from ? [{ label: 'Evolves from', value: evo.from }] : []),
        ...(evo.to ? [{ label: 'Evolves to', value: evo.to }] : []),
        ...(hostFacts ? hostFacts(card) : []),
    ];
    const ordered = [...actions].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
    const [first, second, ...rest] = ordered;
    const press = (action) => () => {
        onClose();
        action.onPress(card);
    };
    const imageW = wide ? Math.min(300, Math.round((windowHeight - SHEET_MARGIN * 2) * (63 / 88) * 0.8)) : undefined;
    const art = (_jsx(View, { style: [styles.art, imageW ? { width: imageW } : null], children: uri ? (_jsx(Image, { source: { uri }, style: styles.image, contentFit: "contain", transition: 120 })) : theme.comingSoonImage ? (_jsx(Image, { source: theme.comingSoonImage, style: styles.image, contentFit: "contain", accessibilityLabel: "Image coming soon" })) : (_jsx(View, { style: styles.imageFallback, children: _jsx(Text, { style: styles.sub, children: "no image" }) })) }));
    const arrow = (dir, go) => go ? (_jsx(Pressable, { role: "button", accessibilityLabel: dir === 'prev' ? 'Previous card' : 'Next card', onPress: go, style: [styles.arrow, dir === 'prev' ? styles.arrowPrev : styles.arrowNext], children: _jsx(Text, { style: styles.arrowGlyph, children: dir === 'prev' ? '‹' : '›' }) })) : null;
    return (_jsx(Modal, { visible: true, transparent: true, animationType: "fade", onRequestClose: onClose, children: _jsxs(View, { style: [styles.backdrop, { backgroundColor: theme.overlay }], children: [_jsx(Pressable, { style: StyleSheet.absoluteFill, onPress: onClose, accessibilityLabel: "Close" }), _jsx(View, { style: [styles.box, { maxHeight: windowHeight - SHEET_MARGIN }], children: _jsxs(ScrollView, { style: { overscrollBehavior: 'contain' }, contentContainerStyle: styles.body, bounces: false, alwaysBounceVertical: false, overScrollMode: "never", nestedScrollEnabled: true, children: [art, _jsxs(View, { style: styles.info, children: [_jsxs(View, { style: styles.titleRow, children: [_jsxs(View, { style: { flex: 1, minWidth: 0 }, children: [_jsx(Text, { role: "heading", style: styles.title, numberOfLines: 2, children: card.name }), _jsx(Text, { style: styles.sub, numberOfLines: 1, children: [card.setName, card.number].filter(Boolean).join(' · ') })] }), _jsx(Pressable, { role: "button", accessibilityLabel: "Close", onPress: onClose, hitSlop: 6, style: styles.close, children: _jsx(Text, { style: styles.closeGlyph, children: "\u00D7" }) })] }), tags.length ? (_jsx(View, { style: styles.tags, children: tags.map((t) => (_jsx(View, { style: styles.tag, children: _jsx(Text, { style: styles.tagText, children: t }) }, t))) })) : null, rows.length ? (_jsx(View, { style: styles.rows, children: rows.map((r) => (_jsxs(View, { style: styles.row, children: [_jsx(Text, { style: styles.rowLabel, children: r.label.toUpperCase() }), _jsx(Text, { style: styles.rowValue, numberOfLines: 1, children: r.value })] }, r.label))) })) : null, _jsxs(View, { style: styles.priceBox, children: [_jsx(Text, { style: styles.rowLabel, children: "MARKET" }), _jsxs(View, { style: styles.priceLine, children: [_jsx(View, { style: styles.priceChip, children: _jsx(Text, { style: styles.priceText, children: value > 0 ? formatUsd(value) : '—' }) }), _jsx(Text, { style: [styles.sub, { flex: 1 }], children: value > 0 ? 'TCGplayer market, near mint.' : 'No market price yet.' })] })] }), card.imageSubstituted ? (_jsx(Text, { style: styles.caveat, children: "This image may differ slightly from the real card, it could carry a stamp, overlay, or signature we missed." })) : null, _jsxs(View, { style: styles.mainActions, children: [first ? (_jsx(Pressable, { role: "button", onPress: press(first), style: [styles.btn, first.kind === 'primary' ? styles.btnPrimary : styles.btnSecondary], children: _jsx(Text, { style: first.kind === 'primary' ? styles.btnPrimaryText : styles.btnSecondaryText, numberOfLines: 1, children: resolveLabel(first, card) }) })) : null, second ? (_jsx(Pressable, { role: "button", onPress: press(second), style: [styles.btn, styles.btnSecondary], children: _jsx(Text, { style: [styles.btnSecondaryText, second.kind === 'destructive' && { color: theme.danger }], numberOfLines: 1, children: resolveLabel(second, card) }) })) : null] }), rest.length ? (_jsx(View, { style: styles.compact, children: rest.map((a) => (_jsx(Pressable, { role: "button", onPress: press(a), style: styles.compactBtn, children: _jsx(Text, { style: [styles.compactText, a.kind === 'destructive' && { color: theme.danger }], numberOfLines: 1, children: resolveLabel(a, card) }) }, a.key))) })) : null] })] }) }), arrow('prev', onPrev), arrow('next', onNext)] }) }));
}
function makePopupStyles(s, wide) {
    return StyleSheet.create({
        backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: wide ? 56 : 16 },
        box: {
            width: '100%',
            maxWidth: wide ? POPUP_MAX_WIDTH_WIDE : SHEET_MAX_WIDTH,
            borderRadius: 18,
            backgroundColor: s.background,
            borderTopWidth: 5,
            borderTopColor: s.edge,
            overflow: 'hidden',
        },
        body: { flexDirection: wide ? 'row' : 'column', gap: wide ? 20 : 12, padding: wide ? 18 : 14 },
        art: { aspectRatio: 63 / 88, width: wide ? undefined : '100%', alignSelf: wide ? 'flex-start' : 'center', borderRadius: 10, overflow: 'hidden', backgroundColor: s.panel },
        image: { width: '100%', height: '100%' },
        imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
        info: { flex: wide ? 1 : undefined, minWidth: 0, gap: 12 },
        titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
        title: {
            fontSize: wide ? 24 : 19,
            lineHeight: wide ? 30 : 24,
            fontWeight: '800',
            color: s.title,
            ...(s.glow ? { textShadowColor: s.glow, textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } } : null),
        },
        sub: { fontSize: 13, lineHeight: 18, color: s.subtext },
        close: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: s.panel },
        closeGlyph: { fontSize: 22, lineHeight: 24, color: s.text },
        tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
        tag: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: s.tag },
        tagText: { fontSize: 12, fontWeight: '700', color: s.tagText },
        rows: { gap: 6 },
        row: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
        rowLabel: { width: 96, fontSize: 11, fontWeight: '700', letterSpacing: 1, color: s.subtext },
        rowValue: { flex: 1, fontSize: 14, color: s.text },
        priceBox: { gap: 8, borderWidth: 1, borderColor: s.border, borderRadius: 12, padding: 12 },
        priceLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
        priceChip: { borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: s.priceFill },
        priceText: {
            fontSize: 18,
            color: s.priceText,
            ...(s.priceFont ? { fontFamily: s.priceFont } : { fontWeight: '800' }),
            ...(s.glow ? { textShadowColor: s.glow, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } } : null),
        },
        caveat: { fontSize: 11, lineHeight: 15, fontStyle: 'italic', color: s.subtext },
        mainActions: { flexDirection: wide ? 'row' : 'column', gap: 10, marginTop: 4 },
        btn: { flex: wide ? 1 : undefined, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
        btnPrimary: { backgroundColor: s.primary, borderBottomWidth: 3, borderBottomColor: s.primaryLip ?? s.primary },
        btnPrimaryText: { fontSize: 15, fontWeight: '800', color: s.primaryText },
        btnSecondary: { backgroundColor: s.secondary, borderBottomWidth: 3, borderBottomColor: s.secondaryLip ?? s.secondary },
        btnSecondaryText: { fontSize: 15, fontWeight: '800', color: s.secondaryText },
        compact: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        compactBtn: { flexGrow: 1, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: s.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
        compactText: { fontSize: 13, fontWeight: '700', color: s.link },
        arrow: {
            position: 'absolute',
            top: '50%',
            width: 44,
            height: 44,
            marginTop: -22,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: s.background,
            borderWidth: 2,
            borderColor: s.edge,
        },
        arrowPrev: { left: wide ? 6 : 2 },
        arrowNext: { right: wide ? 6 : 2 },
        arrowGlyph: { fontSize: 26, lineHeight: 28, fontWeight: '800', color: s.edge },
    });
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
            maxWidth: SHEET_MAX_WIDTH,
            borderRadius: 14,
            backgroundColor: t.background,
            overflow: 'hidden',
        },
        sheetBody: { padding: 14, gap: 4 },
        imageWrap: {
            width: '100%',
            aspectRatio: 63 / 88,
            // maxHeight is set per render from the viewport (see CardActionModal).
            alignSelf: 'center',
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
        evo: { fontSize: 12, fontWeight: '600', color: t.link, marginTop: 2 },
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
