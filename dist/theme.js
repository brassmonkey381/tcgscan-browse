/** The kit's original light look — the default when an app passes no theme. */
export const lightTheme = {
    text: '#222',
    subtext: '#888',
    faint: '#aaa',
    accent: '#3B82F6',
    accentText: '#fff',
    link: '#2a5db0',
    background: '#fff',
    panel: '#fafafc',
    border: '#e4e4e8',
    selected: '#e8f0fe',
    danger: '#d1495b',
    imagePlaceholder: '#f0f0f3',
    overlay: 'rgba(10,10,14,0.55)',
};
/** Merge an app's partial override over the light default. */
export function resolveTheme(overrides) {
    return overrides ? { ...lightTheme, ...overrides } : lightTheme;
}
/** Rarity bar palette for analytics — theme-independent (bars need distinct hues). */
export const RARITY_PALETTE = [
    '#3B82F6',
    '#e8833a',
    '#1a9c5b',
    '#c0448f',
    '#7a5cc0',
    '#3aa0a0',
    '#d1495b',
    '#b08900',
    '#5a6b7b',
];
