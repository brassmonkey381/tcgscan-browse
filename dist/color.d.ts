import { type CardLanguage } from './catalog';
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
    /**
     * MODAL: cards with the palette most similar to `productId` (nearest first).
     *
     * `keep` is an optional per-id predicate (the language bound). It is applied during the scan,
     * BEFORE the top-N slice, so a constrained search returns a full `topN` — filtering the slice
     * afterwards would return however few of the top-N happened to qualify.
     */
    findSimilar(productId: string, region: ColorRegion, topN?: number, keep?: (id: string) => boolean): ColorHit[];
    /** PICKER: cards that prominently feature `pick` (LAB). `lambda` biases toward dominant colors.
     *  `keep` (the language bound) filters during the scan — see findSimilar. */
    searchByColor(pick: {
        L: number;
        a: number;
        b: number;
    }, region: ColorRegion, topN?: number, lambda?: number, keep?: (id: string) => boolean): ColorHit[];
    /**
     * MULTI-COLOR PICKER: cards whose palette best matches a WEIGHTED query palette (up to 3 colors
     * with weights). Uses the SAME symmetric weighted set-distance as findSimilar — the query palette
     * plays the role of a card. Weights need not sum to 1 (the metric is coverage-weighted either way).
     * `keep` (the language bound) filters during the scan — see findSimilar.
     */
    searchByColors(query: Lab[], region: ColorRegion, topN?: number, keep?: (id: string) => boolean): ColorHit[];
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
}, region: ColorRegion, { limit, lambda, languages }?: {
    limit?: number;
    lambda?: number;
    languages?: CardLanguage[];
}): Promise<ColorHit[]>;
/** MULTI-COLOR PICKER via the server: cards matching a weighted query palette. Fails soft ([]). */
export declare function searchByColorsServer(query: Lab[], region: ColorRegion, { limit, languages }?: {
    limit?: number;
    languages?: CardLanguage[];
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
    languages?: CardLanguage[];
}): Promise<string[]>;
/**
 * MULTI-COLOR PICKER (hybrid): ids of cards best matching a weighted query palette (up to 3 colors
 * with weights), nearest first. On-device when the index is loaded, else the server RPC.
 */
export declare function searchByColors(query: Lab[], region: ColorRegion, opts?: {
    limit?: number;
    languages?: CardLanguage[];
}): Promise<string[]>;
/**
 * MODAL: ids of cards with the palette nearest `productId`, nearest first. ON-DEVICE ONLY.
 *
 * IT USED TO FALL BACK TO A SERVER RPC and there is no longer a server to fall back to.
 * `find_similar_by_color` was dropped from the data project on 2026-09-11 rather than carried
 * through the grant boundary, because it never worked: 0 successes in 6 calls, every one a 57014
 * statement timeout at 3.1 to 3.5 seconds, anonymous and unmetered. The fallback returned [] on
 * any non-2xx, so for as long as anyone has measured it this branch has produced an empty list
 * after a three second wait. Removing it changes the wait, not the answer.
 *
 * The on-device path is untouched and was always the one doing the work: a card the colour index
 * holds answers locally in microseconds. A card it does not hold now returns [] immediately, which
 * is what the server branch returned anyway. michi's ColorSearchSheet already shows a note for the
 * empty case, which is why this degrades quietly rather than looking broken.
 */
export declare function findSimilarByColor(productId: string, region: ColorRegion, opts?: {
    limit?: number;
    languages?: CardLanguage[];
}): Promise<string[]>;
