/** The size steps in order (small → large) — build a matching toggle from this. */
export const CARD_SIZES = ['S', 'M', 'L'];
/**
 * Columns per Size step, as a fraction of the base packing for a given tile width (S = the dense
 * base, M / L progressively fewer columns → larger cards). Proportional (not a fixed delta) so the
 * step stays meaningful on wide/desktop views; the result clamps to ≥1 so L can reach full-width
 * on a narrow phone.
 */
export const CARD_SIZE_FRACTION = { S: 1, M: 0.72, L: 0.45 };
/**
 * Relative size multiplier per step — the general-purpose knob for surfaces that DON'T have a free
 * column count (binder pages with fixed pockets, carousels, fixed-layout tiles). Multiply the
 * surface's base tile dimension by this to render cards at the S/M/L norm. (Dense grids should use
 * `cardGridColumns` instead, which produces the exact column steps.)
 */
export const CARD_SIZE_SCALE = { S: 0.8, M: 1, L: 1.35 };
/** Default gap (px) between card tiles the column math assumes. */
export const CARD_GRID_GAP = 6;
/** Above this rendered tile width (px), request the 640px image tier so big cards stay sharp
 *  instead of upscaling the dense 245px webp. */
export const CARD_HIRES_TILE_W = 150;
/**
 * Column count for a dense card grid at a given Size step: pack `baseTileWidth` into
 * `containerWidth`, then scale by the Size fraction (min 1 column). The formula CatalogBrowser
 * uses — reuse it for any card grid so sizes match across surfaces.
 */
export function cardGridColumns(containerWidth, baseTileWidth, size, gap = CARD_GRID_GAP) {
    if (containerWidth <= 0 || baseTileWidth <= 0)
        return 1;
    const base = Math.max(3, Math.floor((containerWidth + gap) / (baseTileWidth + gap)));
    return Math.max(1, Math.round(base * CARD_SIZE_FRACTION[size]));
}
/** The rendered tile width (px) once `cols` columns share `containerWidth`. */
export function cardTileWidthFor(containerWidth, cols, gap = CARD_GRID_GAP) {
    return Math.floor((containerWidth - gap * (cols - 1)) / cols);
}
/** The image tier a tile of `tileWidth` px should request (640 for large tiles, else 245). */
export function cardTierFor(tileWidth) {
    return tileWidth >= CARD_HIRES_TILE_W ? 640 : 245;
}
