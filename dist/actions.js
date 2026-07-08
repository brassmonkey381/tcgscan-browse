/** Resolve a static or dynamic label against a card. */
export function resolveLabel(action, card) {
    return typeof action.label === 'function' ? action.label(card) : action.label;
}
/** Drop actions hidden for this card via `available`. */
export function resolveActions(actions, card) {
    return actions.filter((a) => (a.available ? a.available(card) : true));
}
