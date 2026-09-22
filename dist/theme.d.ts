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
    /**
     * The tile drawn when a card has no picture. An `Image` source, supplied by the HOST app so one
     * kit can serve two brands -- TCGScan passes its logomark tile, michi-maker passes its own.
     * Omitted, the kit keeps its plain "no image" text, which is what it did before this existed.
     *
     * It exists because the alternative on a browse grid is a grey rectangle a person reads as a
     * broken image rather than as a card the catalogue has no art for yet. Note what it is NOT:
     * TCGPlayer serves its own logo-watermarked "Image Coming Soon" JPEG with an HTTP 200, and
     * tcgscan-data's catalog/placeholders.py suppresses those from the image manifest so one can
     * never arrive here as if it were real art.
     */
    comingSoonImage?: number | {
        uri: string;
    };
}
/** The kit's original light look — the default when an app passes no theme. */
export declare const lightTheme: BrowseTheme;
/** Merge an app's partial override over the light default. */
export declare function resolveTheme(overrides?: Partial<BrowseTheme>): BrowseTheme;
/**
 * Soft lift for tiles (set tiles, taxonomy tiles) — makes them read as physical objects on the
 * shelf, matching michi-maker's binder-page shadows. Subtle enough to disappear gracefully on
 * dark themes; iOS/web read the shadow* props, Android reads `elevation`.
 */
export declare const tileShadow: {
    readonly shadowColor: "#000000";
    readonly shadowOpacity: 0.08;
    readonly shadowRadius: 8;
    readonly shadowOffset: {
        readonly width: 0;
        readonly height: 3;
    };
    readonly elevation: 2;
};
/** Rarity bar palette for analytics — theme-independent (bars need distinct hues). */
export declare const RARITY_PALETTE: string[];
