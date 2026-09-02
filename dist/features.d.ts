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
 *   colorSearch    advisory only — the colour entry point is already host-supplied via
 *                  `onColorSearch`, so hosts branch there (michi swaps tri-colour for the simple
 *                  energy picker). Listed here so a host can express the whole set in one place.
 *
 * Because a locked query token is REWRITTEN rather than rejected, `lockedQueryNotice` reports what
 * was dropped so the UI can say so — a search that silently ignores what you typed reads as a bug.
 */
import type { ParsedQuery } from './query';
/** A capability a host may lock. */
export type BrowseFeature = 'sortByValue' | 'priceFilter' | 'findSimilar' | 'similarRefine' | 'colorSearch';
/** Stable display names, so hosts and the kit describe the same thing in upsells. */
export declare const FEATURE_LABELS: Record<BrowseFeature, string>;
/** Convenience: is `feature` locked for this host? */
export declare function isLocked(locked: readonly BrowseFeature[] | undefined, feature: BrowseFeature): boolean;
/**
 * Rewrite a parsed query so it cannot use locked features.
 *
 * Applied to the query the kit actually RUNS (warm and cold alike), not just to the UI, so a
 * locked user cannot reach the feature by typing it. Returns the original object unchanged when
 * nothing is locked, keeping memo identity stable on the common path.
 */
export declare function applyFeatureLocks(parsed: ParsedQuery, locked: readonly BrowseFeature[] | undefined): ParsedQuery;
/**
 * What `applyFeatureLocks` dropped from the user's typed query, as a short sentence to show under
 * the search box — or '' when nothing was dropped. Says what was ignored and why, so the result
 * set never looks like it silently disagreed with the query.
 */
export declare function lockedQueryNotice(parsed: ParsedQuery, locked: readonly BrowseFeature[] | undefined): string;
