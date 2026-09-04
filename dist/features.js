/** Stable display names, so hosts and the kit describe the same thing in upsells. */
export const FEATURE_LABELS = {
    sortByValue: 'Sort by value',
    priceFilter: 'Price filters',
    findSimilar: 'Find similar',
    similarRefine: 'Refine by similarity',
    themeSearch: 'Artwork theme search',
    colorSearch: 'Colour search',
};
/** Convenience: is `feature` locked for this host? */
export function isLocked(locked, feature) {
    return !!locked && locked.includes(feature);
}
/**
 * Rewrite a parsed query so it cannot use locked features.
 *
 * Applied to the query the kit actually RUNS (warm and cold alike), not just to the UI, so a
 * locked user cannot reach the feature by typing it. Returns the original object unchanged when
 * nothing is locked, keeping memo identity stable on the common path.
 */
export function applyFeatureLocks(parsed, locked) {
    if (!locked?.length)
        return parsed;
    const dropValueSort = isLocked(locked, 'sortByValue') && parsed.sort === 'value';
    const dropPrice = isLocked(locked, 'priceFilter') && (parsed.minPrice !== null || parsed.maxPrice !== null);
    const dropTheme = isLocked(locked, 'themeSearch') && parsed.fields.some((f) => f.key === 'theme');
    if (!dropValueSort && !dropPrice && !dropTheme)
        return parsed;
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
export function lockedQueryNotice(parsed, locked) {
    if (!locked?.length)
        return '';
    const dropped = [];
    if (isLocked(locked, 'sortByValue') && parsed.sort === 'value')
        dropped.push('sort by value');
    if (isLocked(locked, 'priceFilter') && (parsed.minPrice !== null || parsed.maxPrice !== null)) {
        dropped.push('price filters');
    }
    if (isLocked(locked, 'themeSearch') && parsed.fields.some((f) => f.key === 'theme')) {
        dropped.push('artwork theme search');
    }
    if (!dropped.length)
        return '';
    // Lead with the label so there is no verb to agree with ("price filters is…" was the naive
    // version). Reads the same for one dropped feature or several.
    return `Not included on your plan: ${dropped.join(', ')}`;
}
