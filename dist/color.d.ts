/** Which region of the card the palette is measured over. */
export type ColorRegion = 'noborder' | 'art';
/** One dominant color: CIELAB + coverage weight (0..1). */
export interface Lab {
    L: number;
    a: number;
    b: number;
    w: number;
}
/** A color-search hit: a card id + its score/distance (lower = closer for both RPCs). */
export interface ColorHit {
    id: string;
    score: number;
}
/** True when the data server's REST API is reachable (the server color path can run). */
export declare function colorServerAvailable(): boolean;
/** sRGB (0..255) → CIELAB. Feed a picked swatch through this before searchByColor. */
export declare function srgbToLab(r: number, g: number, b: number): {
    L: number;
    a: number;
    b: number;
};
/** CIELAB → sRGB (0..255), for drawing a card's stored-color swatches. */
export declare function labToSrgb(L: number, a: number, b: number): {
    r: number;
    g: number;
    b: number;
};
/**
 * On-device color index — loads the packed `card_colors.bin` (+ ids + meta) and computes both
 * features locally in a few ms. Layout is read from the meta (never hardcoded). See the data
 * contract in docs/COLOR-SIMILARITY.md.
 */
export declare class ColorIndex {
    private buf;
    private ids;
    private rowOf;
    private regions;
    private k;
    private bpcolor;
    private bpcard;
    /** True once the blob is parsed. */
    ready: boolean;
    /** Load the three files from `base` (a URL dir). Resolves even on failure — check `ready`. */
    load(base: string): Promise<void>;
    /** Is this card in the color index? */
    has(productId: string): boolean;
    /** The card's dominant colors for one region (empty if absent). */
    colors(productId: string, region: ColorRegion): Lab[];
    /** Symmetric weighted color-set distance — mirrors the server/pipeline metric. */
    private static setDist;
    /** MODAL: cards with the palette most similar to `productId` (nearest first). */
    findSimilar(productId: string, region: ColorRegion, topN?: number): ColorHit[];
    /** PICKER: cards that prominently feature `pick` (LAB). `lambda` biases toward dominant colors. */
    searchByColor(pick: {
        L: number;
        a: number;
        b: number;
    }, region: ColorRegion, topN?: number, lambda?: number): ColorHit[];
    /**
     * MULTI-COLOR PICKER: cards whose palette best matches a WEIGHTED query palette (up to 3 colors
     * with weights). Uses the SAME symmetric weighted set-distance as findSimilar — the query palette
     * plays the role of a card. Weights need not sum to 1 (the metric is coverage-weighted either way).
     */
    searchByColors(query: Lab[], region: ColorRegion, topN?: number): ColorHit[];
}
/** Load-once on-device color index from the configured color URL. Fails soft → null. */
export declare function loadColorIndex(): Promise<ColorIndex | null>;
/** The loaded on-device index, or null if not (yet) loaded. */
export declare function getColorIndex(): ColorIndex | null;
/**
 * React hook: kicks off the on-device index load when `enabled` and returns it once ready (null
 * until then). Wire `enabled` to "warm" clients (signed-in / bundled) so the first color tap is
 * already local; guests can leave it false and use the server path. Fail-soft: stays null on error.
 */
export declare function useColorIndex(enabled: boolean): ColorIndex | null;
/** PICKER via the server: cards prominently featuring `pick`. Fails soft ([]). */
export declare function searchByColorServer(pick: {
    L: number;
    a: number;
    b: number;
}, region: ColorRegion, { limit, lambda }?: {
    limit?: number;
    lambda?: number;
}): Promise<ColorHit[]>;
/** MULTI-COLOR PICKER via the server: cards matching a weighted query palette. Fails soft ([]). */
export declare function searchByColorsServer(query: Lab[], region: ColorRegion, { limit }?: {
    limit?: number;
}): Promise<ColorHit[]>;
/** MODAL via the server: cards with the nearest palette to `productId`. Fails soft ([]). */
export declare function findSimilarByColorServer(productId: string, region: ColorRegion, { limit }?: {
    limit?: number;
}): Promise<ColorHit[]>;
/** True when EITHER color path is usable (on-device index loaded, or server reachable). */
export declare function colorSearchAvailable(): boolean;
/**
 * PICKER (hybrid): ids of cards prominently featuring `pick`, nearest first. Uses the on-device
 * index when loaded, else the server RPC. Returns ids only (resolve via catalog / fetchCardsByIds).
 */
export declare function searchByColor(pick: {
    L: number;
    a: number;
    b: number;
}, region: ColorRegion, opts?: {
    limit?: number;
    lambda?: number;
}): Promise<string[]>;
/**
 * MULTI-COLOR PICKER (hybrid): ids of cards best matching a weighted query palette (up to 3 colors
 * with weights), nearest first. On-device when the index is loaded, else the server RPC.
 */
export declare function searchByColors(query: Lab[], region: ColorRegion, opts?: {
    limit?: number;
}): Promise<string[]>;
/**
 * MODAL (hybrid): ids of cards with the palette nearest `productId`, nearest first. On-device when
 * the index holds the card, else the server RPC. Returns ids only.
 */
export declare function findSimilarByColor(productId: string, region: ColorRegion, opts?: {
    limit?: number;
}): Promise<string[]>;
