/**
 * BrowseTheme — the small injected color contract for the browse kit.
 *
 * The package must never import either app's theme (or a router). Instead every
 * visual surface (CatalogBrowser, CardActionModal, the analytics views) reads its
 * colors from a `BrowseTheme`. Apps pass `theme={...}` (or a partial override) to
 * `CatalogBrowser`; components that render standalone accept a `theme` prop too.
 *
 * The default is `lightTheme`, matching the kit's original light-only look, so
 * existing consumers that pass nothing are unchanged. tcgscan-app supplies a dark
 * variant by overriding the fields it cares about — `resolveTheme` fills the rest.
 */
export interface BrowseTheme {
  /** Primary text (names, values). */
  text: string;
  /** Secondary text (meta lines, labels). */
  subtext: string;
  /** Faint text (placeholders, breadcrumb separators, disabled). */
  faint: string;
  /** Brand accent — active chips, primary buttons, chart line. */
  accent: string;
  /** Text/inner drawn on an `accent` fill. */
  accentText: string;
  /** Link-style accent text on a neutral background. */
  link: string;
  /** Sheet / list background. */
  background: string;
  /** Tile / card / panel surface. */
  panel: string;
  /** Panel + input + chip border. */
  border: string;
  /** Active/selected tint background. */
  selected: string;
  /** Destructive action tint. */
  danger: string;
  /** Image placeholder fill. */
  imagePlaceholder: string;
  /** Modal backdrop scrim. */
  overlay: string;
}

/** The kit's original light look — the default when an app passes no theme. */
export const lightTheme: BrowseTheme = {
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
export function resolveTheme(overrides?: Partial<BrowseTheme>): BrowseTheme {
  return overrides ? { ...lightTheme, ...overrides } : lightTheme;
}

/**
 * Soft lift for tiles (set tiles, taxonomy tiles) — makes them read as physical objects on the
 * shelf, matching michi-maker's binder-page shadows. Subtle enough to disappear gracefully on
 * dark themes; iOS/web read the shadow* props, Android reads `elevation`.
 */
export const tileShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

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
