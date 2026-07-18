/**
 * tcgscan-browse — the shared Pokemon TCG card-browse kit for the TCGScan apps.
 *
 * One import surface for: the tcgscan-data server clients (catalog, prices,
 * similarity), the search query grammar (+ its "?" manual content), and the
 * CatalogBrowser React Native component. Consumers call `configureBrowse(...)`
 * once at startup (from app code, where EXPO_PUBLIC_* env inlining works) and
 * inject app-specific actions (place/portfolio-add/find-similar) via props.
 */
export { configureBrowse, getApiKey, getApiUrl, getBrowseUrl, getImgBase, resolveImageUrl, cardThumbUrl, cdnImageUrl, productUrl, setShopUrl, type BrowseConfig, type CatalogSource, } from './config';
export { hydrateImageManifest, imageManifestReady, subscribeImageManifest, useImageManifest, type ManifestCache, } from './images';
export { evolutionNeighbors, formatSetDate, getCatalog, getCatalogStatus, getLoadedCatalog, loadCatalog, prefetchCatalog, seriesDateRange, subscribeCatalog, subscribeCatalogStatus, useCatalogStatus, type Catalog, type CatalogStatus, type CatalogLoadStatus, type CatalogCard, type CatalogSeries, type CatalogSet, type CardKind, type CardLanguage, type RawCard, type RawCatalog, type RawSeries, type RawSet, type RawVUnionGroup, type VUnionGroup, } from './catalog';
export { formatUsd, getCardPrices, getPriceSummary, getValueSeries, lastMarket, orderedVariants, pctChange, priceSnapshot, rangeCutoff, TIME_RANGES, usePriceSummary, windowByRange, type CardPrices, type PricePoint, type PriceSummary, type PriceSummaryEntry, type TimeRange, type ValueSeriesKind, type ValueSeriesPoint, } from './prices';
export { PriceChart, SeriesAnalytics, SetAnalytics, ValueOverTimeChart, type ValuePoint, } from './analytics';
export { resolveActions, resolveLabel, type BrowserBuiltins, type CardAction, type CardActionsFactory, } from './actions';
export { lightTheme, resolveTheme, tileShadow, RARITY_PALETTE, type BrowseTheme } from './theme';
export { findSimilar, findSimilarToMany, findSimilarWeighted, refineWeights, similarAvailable, type SimilarHit, type SimilarStep, } from './similar';
export { fetchCardsByIds, fetchSetCards, searchCards, searchFacets, serverSearchAvailable, type SearchPage, type ServerFacetSelection, } from './search';
export { loadTaxonomy, useTaxonomy, type TaxonomySource } from './taxonomy';
export { loadSealed, loadSealedPrices, sealedLanguageOf, useSealed, type SealedCatalog, type SealedProduct, type SealedSet, } from './sealed';
export { describeQuery, matchCard, parseQuery, QUERY_HINT, QUERY_MANUAL, runQuery, scoreCard, sortCards, type CompareField, type CompareOp, type Comparison, type FieldKey, type ManualSection, type ParsedQuery, type QueryableCard, type QuerySort, type SortDir, } from './query';
export { browseState, sendBrowseCommand, subscribeBrowseCommand, type BrowseCommand, type BrowseState, type CardSize, } from './state';
export { CARD_SIZES, CARD_SIZE_FRACTION, CARD_GRID_GAP, CARD_HIRES_TILE_W, cardGridColumns, cardTileWidthFor, cardTierFor, } from './cardSize';
export { CatalogBrowser } from './CatalogBrowser';
export { CardActionModal } from './CardActionModal';
export { RecentProducts, type FeedSet } from './RecentProducts';
