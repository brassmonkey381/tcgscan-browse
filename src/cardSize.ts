/**
 * The kit's card-size NORMS — the single source of truth for the S / M / L rendered-card sizes
 * used by the CatalogBrowser toolbar toggle, and meant to be the defacto standard for every other
 * card grid across the upstream apps (michi-maker binder grids/carousels, tcgscan-app portfolio,
 * …). Import `cardGridColumns` / `cardTileWidthFor` so any surface renders the same S/M/L steps
 * instead of hard-coding its own column math.
 */
import type { CardSize } from './state';

/** The size steps in order (small → large) — build a matching toggle from this. */
export const CARD_SIZES: readonly CardSize[] = ['S', 'M', 'L'];

/**
 * Columns per Size step, as a fraction of the base packing for a given tile width (S = the dense
 * base, M / L progressively fewer columns → larger cards). Proportional (not a fixed delta) so the
 * step stays meaningful on wide/desktop views; the result clamps to ≥1 so L can reach full-width
 * on a narrow phone.
 */
export const CARD_SIZE_FRACTION: Record<CardSize, number> = { S: 1, M: 0.72, L: 0.45 };

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
export function cardGridColumns(
  containerWidth: number,
  baseTileWidth: number,
  size: CardSize,
  gap: number = CARD_GRID_GAP,
): number {
  if (containerWidth <= 0 || baseTileWidth <= 0) return 1;
  const base = Math.max(3, Math.floor((containerWidth + gap) / (baseTileWidth + gap)));
  return Math.max(1, Math.round(base * CARD_SIZE_FRACTION[size]));
}

/** The rendered tile width (px) once `cols` columns share `containerWidth`. */
export function cardTileWidthFor(
  containerWidth: number,
  cols: number,
  gap: number = CARD_GRID_GAP,
): number {
  return Math.floor((containerWidth - gap * (cols - 1)) / cols);
}

/** The image tier a tile of `tileWidth` px should request (640 for large tiles, else 245). */
export function cardTierFor(tileWidth: number): 245 | 640 {
  return tileWidth >= CARD_HIRES_TILE_W ? 640 : 245;
}
