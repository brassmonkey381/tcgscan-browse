/**
 * tcgscan-browse — the shared Pokemon TCG card-browse kit for the TCGScan apps.
 *
 * One import surface for: the tcgscan-data server clients (catalog, prices,
 * similarity), the search query grammar (+ its "?" manual content), and the
 * CatalogBrowser React Native component. Consumers call `configureBrowse(...)`
 * once at startup (from app code, where EXPO_PUBLIC_* env inlining works) and
 * inject app-specific actions (place/portfolio-add/find-similar) via props.
 */
export { configureBrowse, getApiKey, getApiUrl, getBrowseUrl, getImgBase, resolveImageUrl, cardThumbUrl, cdnImageUrl, productUrl, setShopUrl, affiliateUrl, ebaySearchUrl, ebayCardSearchUrl, } from './config';
export { effectiveLanguages, getBrowseLanguages, hydrateBrowseLanguages, languageLabel, languageShortLabel, LANGUAGE_ORDER, normalizeLanguages, setBrowseLanguages, subscribeBrowseLanguages, useBrowseLanguages, } from './language';
export { LanguageToggle } from './LanguageToggle';
export { applyFeatureLocks, FEATURE_LABELS, isLocked, lockedQueryNotice, } from './features';
export { hydrateImageManifest, imageManifestReady, subscribeImageManifest, useImageManifest, } from './images';
export { evolutionNeighbors, formatSetDate, getCatalog, getCatalogStatus, getLoadedCatalog, loadCatalog, prefetchCatalog, seriesDateRange, subscribeCatalog, subscribeCatalogStatus, useCatalogStatus, } from './catalog';
export { formatUsd, getCardPrices, getPriceSummary, getValueSeries, lastMarket, orderedVariants, pctChange, priceSnapshot, rangeCutoff, TIME_RANGES, usePriceSummary, windowByRange, } from './prices';
export { PriceChart, SeriesAnalytics, SetAnalytics, ValueOverTimeChart, } from './analytics';
export { resolveActions, resolveLabel, } from './actions';
export { lightTheme, resolveTheme, tileShadow, RARITY_PALETTE } from './theme';
export { findSimilar, findSimilarToMany, findSimilarWeighted, getSimilarityModel, listSimilarityModels, refineWeights, setSimilarityModel, similarAvailable, } from './similar';
export { ColorIndex, colorSearchAvailable, colorServerAvailable, findSimilarByColor, findSimilarByColorServer, getColorIndex, labToSrgb, loadColorIndex, searchByColor, searchByColorServer, searchByColors, searchByColorsServer, srgbToLab, useColorIndex, } from './color';
export { fetchCardDetail, fetchCardsByIds, fetchSetCards, searchCards, searchFacets, serverSearchAvailable, } from './search';
export { loadTaxonomy, useTaxonomy } from './taxonomy';
export { loadSealed, loadSealedPrices, sealedLanguageOf, useSealed, } from './sealed';
export { SEALED_GROUPS, sealedGroupOf } from './sealed-groups';
export { describeQuery, matchCard, parseQuery, QUERY_HINT, QUERY_MANUAL, runQuery, scoreCard, sortCards, } from './query';
export { isSearchSaved, listSavedSearches, removeSavedSearch, subscribeSavedSearches, toggleSavedSearch, } from './savedSearches';
export { browseState, sendBrowseCommand, subscribeBrowseCommand, } from './state';
export { CARD_SIZES, CARD_SIZE_FRACTION, CARD_SIZE_SCALE, CARD_GRID_GAP, CARD_HIRES_TILE_W, cardGridColumns, cardTileWidthFor, cardTierFor, } from './cardSize';
export { CatalogBrowser } from './CatalogBrowser';
export { CardActionModal } from './CardActionModal';
export { RecentProducts } from './RecentProducts';
// Mounted by tcgscan-app only. michi-maker deliberately does not import it — it curates sealed
// through its own HomeSealed carousel — which is how the kit hides a surface from one app: the
// host decides by importing, not by a flag (RecentProducts is the same story in reverse).
export { SealedBrowser } from './SealedBrowser';
