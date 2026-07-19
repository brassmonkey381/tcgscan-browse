/**
 * The kit's card-size NORMS — the single source of truth for the S / M / L rendered-card sizes
 * used by the CatalogBrowser toolbar toggle, and meant to be the defacto standard for every other
 * card grid across the upstream apps (michi-maker binder grids/carousels, tcgscan-app portfolio,
 * …). Import `cardGridColumns` / `cardTileWidthFor` so any surface renders the same S/M/L steps
 * instead of hard-coding its own column math.
 */
import type { CardSize } from './state';
/** The size steps in order (small → large) — build a matching toggle from this. */
export declare const CARD_SIZES: readonly CardSize[];
/**
 * Columns per Size step, as a fraction of the base packing for a given tile width (S = the dense
 * base, M / L progressively fewer columns → larger cards). Proportional (not a fixed delta) so the
 * step stays meaningful on wide/desktop views; the result clamps to ≥1 so L can reach full-width
 * on a narrow phone.
 */
export declare const CARD_SIZE_FRACTION: Record<CardSize, number>;
/**
 * Relative size multiplier per step — the general-purpose knob for surfaces that DON'T have a free
 * column count (binder pages with fixed pockets, carousels, fixed-layout tiles). Multiply the
 * surface's base tile dimension by this to render cards at the S/M/L norm. (Dense grids should use
 * `cardGridColumns` instead, which produces the exact column steps.)
 */
export declare const CARD_SIZE_SCALE: Record<CardSize, number>;
/** Default gap (px) between card tiles the column math assumes. */
export declare const CARD_GRID_GAP = 6;
/** Above this rendered tile width (px), request the 640px image tier so big cards stay sharp
 *  instead of upscaling the dense 245px webp. */
export declare const CARD_HIRES_TILE_W = 150;
/**
 * Column count for a dense card grid at a given Size step: pack `baseTileWidth` into
 * `containerWidth`, then scale by the Size fraction (min 1 column). The formula CatalogBrowser
 * uses — reuse it for any card grid so sizes match across surfaces.
 */
export declare function cardGridColumns(containerWidth: number, baseTileWidth: number, size: CardSize, gap?: number): number;
/** The rendered tile width (px) once `cols` columns share `containerWidth`. */
export declare function cardTileWidthFor(containerWidth: number, cols: number, gap?: number): number;
/** The image tier a tile of `tileWidth` px should request (640 for large tiles, else 245). */
export declare function cardTierFor(tileWidth: number): 245 | 640;
