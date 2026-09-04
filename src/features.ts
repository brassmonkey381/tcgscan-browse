/**
 * Gateable browse features — the seam that lets a host lock parts of search behind its own tiers
 * WITHOUT the kit knowing anything about tiers, entitlements or pricing.
 *
 * The kit stays tier-agnostic on purpose (same rule as `onColorSearch`): it exposes which
 * capabilities exist, the host decides which are locked for the current user and supplies the
 * upsell. Two apps with different tier models therefore share one implementation.
 *
 * A locked feature is never silently broken. Every one has a defined degraded behaviour:
 *
 *   sortByValue    the Value sort chip renders locked; tapping it calls `onLockedFeature`
 *                  instead of sorting. A typed `sort:value` (or its price/worth aliases) is
 *                  stripped back to relevance rather than quietly ignored.
 *   priceFilter    typed price bounds (`>$100`, `<$500`, `value>100`) are stripped from the
 *                  query. The search still runs, just unbounded by price.
 *   findSimilar    the one-shot "≈ Find similar" (and "find similar to all", and a `similar`
 *                  command from the bus) calls `onLockedFeature` instead of searching. The action
 *                  stays in the card sheet: an entry point that vanishes teaches nobody what it
 *                  was, where one that answers the tap can carry the host's upsell.
 *   similarRefine  the "more/less like this" refinement calls `onLockedFeature`. Separate from
 *                  `findSimilar` because a host may sell them apart — michi did, for a month.
 *   themeSearch    typed `theme:` / `art:` / `scene:` constraints are stripped from the query.
 *                  The search still runs, just without the artwork constraint -- the same
 *                  degrade as `priceFilter`, and for the same reason: a query that returns
 *                  nothing teaches less than one that returns the unfiltered set plus a notice.
 *   colorSearch    advisory only — the colour entry point is already host-supplied via
 *                  `onColorSearch`, so hosts branch there (michi swaps tri-colour for the simple
 *                  energy picker). Listed here so a host can express the whole set in one place.
 *
 * Because a locked query token is REWRITTEN rather than rejected, `lockedQueryNotice` reports what
 * was dropped so the UI can say so — a search that silently ignores what you typed reads as a bug.
 */
import type { ParsedQuery } from './query';

/** A capability a host may lock. */
export type BrowseFeature =
  | 'sortByValue'
  | 'priceFilter'
  | 'findSimilar'
  | 'similarRefine'
  | 'themeSearch'
  | 'colorSearch';

/** Stable display names, so hosts and the kit describe the same thing in upsells. */
export const FEATURE_LABELS: Record<BrowseFeature, string> = {
  sortByValue: 'Sort by value',
  priceFilter: 'Price filters',
  findSimilar: 'Find similar',
  similarRefine: 'Refine by similarity',
  themeSearch: 'Artwork theme search',
  colorSearch: 'Colour search',
};

/** Convenience: is `feature` locked for this host? */
export function isLocked(locked: readonly BrowseFeature[] | undefined, feature: BrowseFeature): boolean {
  return !!locked && locked.includes(feature);
}

/**
 * Rewrite a parsed query so it cannot use locked features.
 *
 * Applied to the query the kit actually RUNS (warm and cold alike), not just to the UI, so a
 * locked user cannot reach the feature by typing it. Returns the original object unchanged when
 * nothing is locked, keeping memo identity stable on the common path.
 */
export function applyFeatureLocks(
  parsed: ParsedQuery,
  locked: readonly BrowseFeature[] | undefined,
): ParsedQuery {
  if (!locked?.length) return parsed;
  const dropValueSort = isLocked(locked, 'sortByValue') && parsed.sort === 'value';
  const dropPrice = isLocked(locked, 'priceFilter') && (parsed.minPrice !== null || parsed.maxPrice !== null);
  const dropTheme = isLocked(locked, 'themeSearch') && parsed.fields.some((f) => f.key === 'theme');
  if (!dropValueSort && !dropPrice && !dropTheme) return parsed;
  return {
    ...parsed,
    sort: dropValueSort ? 'relevance' : parsed.sort,
    sortDir: dropValueSort ? 'desc' : parsed.sortDir,
    minPrice: dropPrice ? null : parsed.minPrice,
    maxPrice: dropPrice ? null : parsed.maxPrice,
    // Stripped from the RUN query, so a locked user cannot reach the server field by typing it.
    // The cold path forwards parsed.fields straight into p_fields, which is exactly why this has
    // to happen here rather than in the UI.
    fields: dropTheme ? parsed.fields.filter((f) => f.key !== 'theme') : parsed.fields,
  };
}

/**
 * What `applyFeatureLocks` dropped from the user's typed query, as a short sentence to show under
 * the search box — or '' when nothing was dropped. Says what was ignored and why, so the result
 * set never looks like it silently disagreed with the query.
 */
export function lockedQueryNotice(
  parsed: ParsedQuery,
  locked: readonly BrowseFeature[] | undefined,
): string {
  if (!locked?.length) return '';
  const dropped: string[] = [];
  if (isLocked(locked, 'sortByValue') && parsed.sort === 'value') dropped.push('sort by value');
  if (isLocked(locked, 'priceFilter') && (parsed.minPrice !== null || parsed.maxPrice !== null)) {
    dropped.push('price filters');
  }
  if (isLocked(locked, 'themeSearch') && parsed.fields.some((f) => f.key === 'theme')) {
    dropped.push('artwork theme search');
  }
  if (!dropped.length) return '';
  // Lead with the label so there is no verb to agree with ("price filters is…" was the naive
  // version). Reads the same for one dropped feature or several.
  return `Not included on your plan: ${dropped.join(', ')}`;
}
