/**
 * tcgscan-browse — the shared Pokemon TCG card-browse kit for the TCGScan apps.
 *
 * One import surface for: the tcgscan-data server clients (catalog, prices,
 * similarity), the search query grammar (+ its "?" manual content), and the
 * CatalogBrowser React Native component. Consumers call `configureBrowse(...)`
 * once at startup (from app code, where EXPO_PUBLIC_* env inlining works) and
 * inject app-specific actions (place/portfolio-add/find-similar) via props.
 */
export { configureBrowse, getApiKey, getApiUrl, getBrowseUrl, getImgBase, resolveImageUrl, cardThumbUrl, type BrowseConfig, } from './config';
export { formatSetDate, getCatalog, getLoadedCatalog, loadCatalog, prefetchCatalog, seriesDateRange, subscribeCatalog, type Catalog, type CatalogCard, type CatalogSeries, type CatalogSet, type CardKind, type RawCard, type RawCatalog, type RawSeries, type RawSet, type RawVUnionGroup, type VUnionGroup, } from './catalog';
export { formatUsd, getPriceSummary, priceSnapshot, usePriceSummary, type PriceSummary, type PriceSummaryEntry, } from './prices';
export { findSimilar, similarAvailable, type SimilarHit } from './similar';
export { describeQuery, matchCard, parseQuery, QUERY_HINT, QUERY_MANUAL, runQuery, scoreCard, sortCards, type FieldKey, type ManualSection, type ParsedQuery, type QueryableCard, type QuerySort, } from './query';
export { browseState, type BrowseState } from './state';
export { CatalogBrowser } from './CatalogBrowser';
export { CardActionModal } from './CardActionModal';
