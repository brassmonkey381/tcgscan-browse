/**
 * Server-side card search — the data server's `search_cards` RPC (see
 * tcgscan-data/supabase/migrations/20260710_12_search_cards.sql). It reproduces the client
 * `runQuery`/`scoreCard`/`sortCards` semantics EXACTLY, so the COLD path (catalog not yet in
 * memory) returns the same result set + order as the warm on-device path — the browser can
 * search in ~one round-trip while the ~28k-card catalog is still downloading/parsing.
 *
 * The client keeps `parseQuery` as the single grammar source of truth and sends STRUCTURED
 * params; no grammar is reimplemented here. Rows come back tile-ready (mapped to CatalogCard,
 * with the price carried separately), so a hit renders + opens its action sheet WITHOUT the
 * card being in the in-memory catalog. Fails soft (empty) — server search is an enhancement.
 *
 * POKEMON'S THEME TOOLBAR (frame, type chips, grouping) rides on `search_cards` itself: see
 * `ThemeToolbar` below. It adds `p_fields` entries to a themed query only, and nothing at its
 * defaults, so every other body is exactly what it was.
 *
 * A SECONDARY GAME (Lorcana, One Piece) has no `search_cards`; its themed queries go to
 * `theme_search` / `theme_facets` (tcgscan-data migration 79) through `searchThemes` /
 * `themeFacets` below, which answer ranked ids only. `mergeThemeHits` maps them onto the game's
 * own public catalog rows, and the rest of the query runs on the device over those.
 */
import { numberKey, type CardKind, type CardLanguage, type CatalogCard } from './catalog';
import { getApiKey, getApiUrl, getThemedSearchProxy } from './config';
import type { ParsedQuery } from './query';

/** One page of server results: tile-ready cards, their prices (by id), and the true total. */
export interface SearchPage {
  cards: CatalogCard[];
  /** Headline value per hit id (RPC `cur`), so cold-mode tiles/sort show prices without the
   *  price summary loaded. */
  priceById: Record<string, number>;
  /** Real match count for the whole query (RPC `total_count` window), for the results header. */
  total: number;
  /**
   * THE METER. True when a themed query came back depth-limited: the server kept the true total
   * but handed over only the first few rows (an anonymous caller's `free_theme_depth`). The
   * caller shows "top N, +M more" and does not page — there is nothing more to fetch this way.
   * Never true on the host's paid path, and never on an ordinary word search.
   */
  clamped: boolean;
  /**
   * A clamped page that should NOT have been: the host's paid endpoint BROKE, so the metered
   * direct path answered. The UI says "temporarily limited" rather than selling an upgrade to
   * someone who already pays — otherwise the first symptom of a broken endpoint is paying members
   * quietly losing a feature.
   *
   * Broke, not refused. A 401 or 403 is the endpoint working correctly and saying the caller does
   * not hold the feature, which is the ordinary free case; only a 5xx, a missing function or a
   * network failure sets this. See `proxyBroke` in searchCards.
   */
  degraded: boolean;
  /**
   * THE SERVER DID NOT ANSWER, as opposed to answering "nothing matches".
   *
   * The page is still empty — everything here fails soft — but an empty page used to be the only
   * signal, so a 500 rendered as a confident "No cards match". On 2026-09-12 the data project's
   * `search_cards` hit its statement timeout on every query without a free-text word, and for as
   * long as that lasted `type:fire` told every user there were no Fire cards. Nobody could tell an
   * outage from a bad query, including the people debugging it. Set on a non-OK response or a
   * thrown fetch; never on a genuine zero-row answer, and never when server search is simply not
   * configured or the language bound is contradictory, since those are answers too.
   */
  failed: boolean;
}

/**
 * The free depth of a themed query, read once from the data project's public `search_config`.
 * Public precisely so the meter can be EXACT: "clamped" is `total > depth`, not an inference
 * from the row count, which misses a page size at or under the depth. 0 (or unreadable) means
 * the meter is off and the row-count fallback in searchCards is the only signal.
 */
let depthPromise: Promise<number> | null = null;

/**
 * Internal: forget every server-search cache (resetBrowseData). They are keyed by card and set id,
 * and ids are one namespace across games, but a set's card list and a card's detail come from the
 * configured api, which the host has just changed.
 */
export function _resetSearchCaches(): void {
  depthPromise = null;
  setCardsCache.clear();
  cardByIdCache.clear();
  cardByIdInflight.clear();
  cardDetailCache.clear();
}

export function freeThemeDepth(): Promise<number> {
  if (!depthPromise) {
    depthPromise = fetch(`${getApiUrl()}/search_config?select=free_theme_depth&limit=1`, {
      headers: { apikey: getApiKey() },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { free_theme_depth?: number }[]) => Number(rows?.[0]?.free_theme_depth) || 0)
      .catch(() => 0);
  }
  return depthPromise;
}

/** True when the app is configured to reach the data server's REST API. */
export function serverSearchAvailable(): boolean {
  return Boolean(getApiUrl() && getApiKey());
}

/** Raw row shape returned by the RPC (snake_case, as PostgREST emits). */
interface SearchRow {
  id: string;
  name: string | null;
  number: string | null;
  rarity: string | null;
  card_type: string[] | null;
  set_id: number | string | null;
  set_name: string | null;
  series: string | null;
  release_date: string | null;
  illustrator: string | null;
  types: string[] | null;
  stage: string | null;
  hp: number | null;
  evolution_stage_index: number | null;
  evolves_from: string | null;
  evolution_line: string[] | null;
  jumbo: boolean | null;
  cur: number | string | null;
  score: number;
  total_count: number | string;
  language?: string | null; // 'en' | 'ja' (added to search_cards at the EN+JP cutover)
  full_art_kind?: string | null; // optional: the server ranks by it itself; carried when present
  // Theme rank facts, optional: carried when present. NO LIVE search_cards RETURNS THEM: migration 81
  // keeps the 21 columns and uses card_themes inside the function only. A later DROP + CREATE could
  // add them (michi's check-data-exposure must allow them in the same change). Public verdicts only,
  // the same three `theme_search` returns; never a tag, scene or probability.
  type_group?: string | null;
  full_art?: boolean | null;
  art_band?: number | null;
}

/** Map an RPC row to a CatalogCard so it renders through the same tile/sheet as warm results. */
function rowToCard(r: SearchRow): CatalogCard {
  return {
    id: String(r.id),
    name: r.name ?? '',
    number: r.number ?? '',
    rarity: r.rarity ?? '',
    cardType: r.card_type ?? [],
    setId: r.set_id == null ? '' : String(r.set_id),
    setName: r.set_name ?? '',
    setCode: '', // not returned by the RPC (not needed to render); joined from set_id when warm
    seriesId: r.series ?? '',
    releaseDate: r.release_date ?? '',
    image: '', // images resolve by id via the manifest (cardThumbUrl), never from the catalog
    kind: (r.jumbo ? 'jumbo' : 'standard') as CardKind,
    illustrator: r.illustrator ?? '',
    types: r.types ?? [],
    stage: r.stage ?? '',
    hp: typeof r.hp === 'number' ? r.hp : null,
    evolutionStage: typeof r.evolution_stage_index === 'number' ? r.evolution_stage_index + 1 : -1,
    evolvesFrom: r.evolves_from ?? '',
    evolutionLine: r.evolution_line ?? [],
    language: r.language === 'ja' ? 'ja' : 'en',
    fullArtKind: r.full_art_kind ?? '',
    // Only when the server sent them (no search_cards does today, 81 included; see SearchRow), so
    // every other row keeps exactly the shape it always had.
    ...(typeof r.full_art === 'boolean' ? { themeFullArt: r.full_art } : {}),
    ...(typeof r.type_group === 'string' && r.type_group ? { themeGroup: r.type_group } : {}),
  };
}

/** Facet chip selection, facet key -> selected values (the kit's FacetSelection shape). */
export type ServerFacetSelection = Record<string, string[]>;

/** Drop empty entries so `{}` (no selection) skips the facet filter entirely server-side. */
function packFacets(facets?: ServerFacetSelection): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(facets ?? {})) if (v.length > 0) out[k] = v;
  return out;
}

/**
 * Fold any `lang:` terms in the query into the LANGUAGE ARGUMENT, and hand back the query with
 * those terms removed.
 *
 * `lang:ja` is a hard language filter, which is exactly what `p_lang` already is — so routing it
 * to the argument rather than to `p_fields` gives warm/cold parity for free, with no new server
 * grammar to keep in sync (the parity rule in AGENTS.md). The warm path reaches the same answer
 * through `fieldValues(card, 'lang')` in query.ts.
 *
 * Composition is an INTERSECTION, like every other AND-ed query term: with the EN/JP toggle on
 * English, `lang:ja` narrows to nothing rather than overriding the user's choice. `languages: []`
 * is that empty case, and callers short-circuit on it instead of sending a request — omitting
 * `p_lang` would mean "unconstrained" and quietly return the opposite of what was asked.
 */
function foldLanguageTerms(
  parsed: ParsedQuery,
  bound?: CardLanguage[],
): { parsed: ParsedQuery; languages: CardLanguage[] | undefined } {
  const asked = parsed.fields.filter((f) => f.key === 'lang').map((f) => f.value);
  if (asked.length === 0) return { parsed, languages: bound };
  const wanted = asked.filter((v): v is CardLanguage => v === 'en' || v === 'ja');
  // An unrecognized value (lang:klingon) matches nothing, same as it does warm.
  const merged = wanted.length === 0 ? [] : bound?.length ? bound.filter((l) => wanted.includes(l)) : wanted;
  return {
    parsed: { ...parsed, fields: parsed.fields.filter((f) => f.key !== 'lang') },
    languages: merged,
  };
}

/**
 * THE POKEMON THEME TOOLBAR (CatalogBrowser's `themeTools`), as `search_cards` takes it: extra
 * `p_fields` entries that only a THEMED query carries (tcgscan-data migration 81 reads them; a
 * server before it, and `search_facets`, answer them with `else true`, i.e. ignore them).
 *   · `{key:'frame', value:'full'|'window'}` keeps full art or windowed art only;
 *   · `{key:'tgroup', value:<group key>}` once per type chip, OR-ed (an energy type, Trainer, Energy);
 *   · `{key:'group', value:'type'}` puts a relevance result in registry type order. The server
 *     honours it for an UNCLAMPED (paid) caller only; a free caller gets the best N by rank, which
 *     the browser groups on the device.
 * The defaults (all art, no chips, ungrouped) add nothing, so such a body is byte-identical to one
 * sent without a toolbar.
 */
export interface ThemeToolbar {
  frame?: ThemeFrame;
  types?: readonly string[];
  group?: boolean;
}

/** The `p_fields` entries a toolbar adds, in a fixed order (frame, chips, grouping). */
export function themeToolbarFields(t?: ThemeToolbar): { key: string; value: string }[] {
  if (!t) return [];
  const out: { key: string; value: string }[] = [];
  if (t.frame === 'full' || t.frame === 'window') out.push({ key: 'frame', value: t.frame });
  for (const k of t.types ?? []) if (k) out.push({ key: 'tgroup', value: k });
  if (t.group) out.push({ key: 'group', value: 'type' });
  return out;
}

/** `p_fields` for a search_cards / search_facets body: the query's fields, then the toolbar's,
 *  which only a themed query carries. */
function fieldsWithToolbar(parsed: ParsedQuery, toolbar?: ThemeToolbar): { key: string; value: string }[] {
  const fields = parsed.fields.map((f) => ({ key: f.key, value: f.value }));
  if (!toolbar || !parsed.fields.some((f) => f.key === 'theme')) return fields;
  return [...fields, ...themeToolbarFields(toolbar)];
}

const POKEMON_TRAINER_TYPES = new Set([
  'Supporter', 'Item', 'Stadium', 'Tool', 'Pokemon Tool', 'Technical Machine', 'Trainer',
]);

/**
 * A Pokemon card's type group as the device can tell it: its first energy type, else Trainer or
 * Energy from its card type, else Other. This mirrors tcgscan-data's `_pokemon_type_of`, except
 * that the server reads `card_type_b`, which the slim catalog does not ship, so a few edge cards
 * may land in a different group than the server's own order puts them. A row that carries the
 * server's `type_group` (a later migration; 81 does not return it) uses that instead. `known` (the registry's group keys) maps
 * an energy type the registry does not list to Other, as the server does.
 */
export function localTypeGroup(card: Pick<CatalogCard, 'types' | 'cardType'>, known?: readonly string[]): string {
  const t = card.types?.find((x) => !!x);
  if (t) return !known?.length || known.includes(t) ? t : 'Other';
  const ct = card.cardType ?? [];
  if (ct.some((x) => POKEMON_TRAINER_TYPES.has(x) || x.startsWith('Trainer'))) return 'Trainer';
  if (ct.some((x) => x.includes('Energy'))) return 'Energy';
  return 'Other';
}

/**
 * Stable-sort rows by a registry's group order: rank order holds inside each group, and a group not
 * in the list sorts last. Shared by both theme paths (mergeThemeHits for a secondary game, and a
 * Pokemon themed result in CatalogBrowser).
 */
export function groupByOrder<T>(rows: readonly T[], order: readonly string[], groupOf: (row: T) => string): T[] {
  if (!order.length) return [...rows];
  const at = new Map(order.map((key, i) => [key, i] as const));
  return rows
    .map((row, i) => [row, i, at.get(groupOf(row)) ?? at.size] as const)
    .sort((a, b) => a[2] - b[2] || a[1] - b[1])
    .map(([row]) => row);
}

/**
 * A search endpoint named per call, for a host that must search a game OTHER than the one the kit
 * is configured for (a card of another game, edited while this one is active) without switching
 * the whole kit, which would reset every per-game cache. `url` is the PostgREST root that serves
 * `rpc/search_cards`; `key` its publishable key.
 */
export interface SearchApi {
  url: string;
  key: string;
}

/**
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages); `facets` are exact-match chip selections (AND across facets,
 * OR within). Returns tile-ready cards + their prices + the real total.
 *
 * `api` searches that endpoint instead of the configured one. Nothing else about the configured
 * game applies to it: the host's themed-search proxy and the free theme depth belong to the
 * configured game, so neither is used, and a themed query is judged by its row count alone.
 */
export async function searchCards(
  parsedIn: ParsedQuery,
  {
    limit = 60,
    offset = 0,
    facets,
    languages: boundIn,
    api,
    toolbar,
  }: {
    limit?: number;
    offset?: number;
    facets?: ServerFacetSelection;
    languages?: CardLanguage[];
    api?: SearchApi;
    /** The Pokemon theme toolbar; appended to a THEMED query's p_fields only (themeToolbarFields). */
    toolbar?: ThemeToolbar;
  } = {},
): Promise<SearchPage> {
  const empty: SearchPage = { cards: [], priceById: {}, total: 0, clamped: false, degraded: false, failed: false };
  const failed: SearchPage = { ...empty, failed: true };
  const apiUrl = api ? api.url : getApiUrl();
  const apiKey = api ? api.key : getApiKey();
  if (!(apiUrl && apiKey)) return empty;
  const { parsed, languages } = foldLanguageTerms(parsedIn, boundIn);
  if (languages?.length === 0) return empty; // contradictory bound (e.g. EN-only + lang:ja)
  try {
    const body = JSON.stringify({
      p_words: parsed.words,
      p_fields: fieldsWithToolbar(parsed, toolbar),
      p_compares: parsed.comparisons.map((c) => ({ field: c.field, op: c.op, value: c.value })),
      p_facets: packFacets(facets),
      p_min_price: parsed.minPrice,
      p_max_price: parsed.maxPrice,
      p_sort: parsed.sort,
      p_dir: parsed.sortDir,
      p_limit: limit,
      p_offset: offset,
      // Only sent when constrained, so the unconstrained default still matches the pre-language
      // RPC overload — the language migration only gates language-CONSTRAINED cold search.
      ...(languages?.length ? { p_lang: languages } : {}),
    });
    const themed = parsed.fields.some((f) => f.key === 'theme');
    // THE PAID PATH FIRST, for a themed query with a host proxy and a caller it vouches for. A
    // refusal (guest, free account, expired grant) or any failure falls through to the direct
    // call below, which the data project meters — so the worst case is the free experience,
    // never a broken one. See ThemedSearchProxy in config.ts.
    let rows: SearchRow[] | null = null;
    let viaProxy = false;
    /**
     * The paid path was asked and BROKE, as opposed to answering "this caller does not hold it".
     *
     * Only this earns the degraded message. A host cannot always know a caller's entitlement
     * before it calls — michi offers a token for every signed-in account and lets the function
     * read the ledger — so 401 and 403 are the normal reply for a free account, and the metered
     * result that follows is exactly right. Treating any refusal as a breakage told every free
     * member that artwork search was "temporarily unavailable" when nothing was wrong with it.
     */
    let proxyBroke = false;
    const proxy = themed && !api ? getThemedSearchProxy() : null;
    if (proxy) {
      // The host sees which themes are asked for, so it can vouch for a caller on one query and
      // not another (a theme it gives away to everyone) without a wasted round trip on the rest.
      const themes = parsed.fields.filter((f) => f.key === 'theme').map((f) => f.value);
      const token = await proxy.getToken({ themes }).catch(() => null);
      if (token) {
        try {
          const res = await fetch(proxy.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body,
          });
          if (res.ok) {
            rows = (await res.json()) as SearchRow[];
            viaProxy = true;
          } else if (res.status !== 401 && res.status !== 403) {
            proxyBroke = true; // 5xx, a bad gateway, a misconfigured function
          }
        } catch {
          rows = null; // the direct path answers
          proxyBroke = true; // offline, CORS, DNS: the endpoint did not get to have an opinion
        }
      }
    }
    if (!rows) {
      const res = await fetch(`${apiUrl}/rpc/search_cards`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body,
      });
      if (!res.ok) return failed;
      rows = (await res.json()) as SearchRow[];
    }
    if (!rows.length) return empty;
    const cards = rows.map(rowToCard);
    const priceById: Record<string, number> = {};
    for (const r of rows) priceById[String(r.id)] = Number(r.cur) || 0;
    const total = Number(rows[0].total_count) || cards.length;
    // Depth-limited: the public free depth is the exact test (`total > depth`), and the row
    // count is the fallback for when that read failed — an unclamped first page of `limit` over
    // `total` matches is min(limit, total) rows long, so a shorter one was cut. Only a themed
    // query on the direct path can be clamped; only page 0 is judged (the server pins it anyway).
    const depth = themed && !viaProxy && !api ? await freeThemeDepth() : 0;
    const clamped =
      themed && !viaProxy && offset === 0
      && ((depth > 0 && total > depth) || cards.length < Math.min(limit, total));
    return { cards, priceById, total, clamped, degraded: clamped && proxyBroke, failed: false };
  } catch {
    // Offline, DNS, CORS, a body that is not JSON. There is no local fallback for a cold search
    // (no catalog to run the query over), so the caller says the server did not answer.
    return failed;
  }
}

/** Which artwork a theme search keeps: all of it, full art only, or windowed only (`p_frame`). */
export type ThemeFrame = 'all' | 'full' | 'window';

/**
 * A SECONDARY GAME'S THEMED QUERY, in the shape `theme_search` takes it. The game's cards live in
 * its own public catalog.json, which carries no captions or tags, so only what needs the artwork
 * goes to the server:
 * - `themes`: the theme field values exactly as parseQuery writes them (`forest`, `character:elsa`,
 *   `-night`), the same values `search_cards` takes;
 * - `words`: the bare words, AND-ed over each card's public text, so the meter counts them too;
 * - `frame`, `types`, `group`: the theme toolbar (full art or windowed, type chips OR-ed within,
 *   pages grouped by type).
 *
 * Everything else in the query (rarity:, set:, price, have:, comparisons, facet chips, an explicit
 * sort) is answered on the device over the merged rows: query.ts `withoutTheme` + `filterCards`.
 */
export interface ThemeQuery {
  themes: string[];
  words: string[];
  frame?: ThemeFrame;
  types?: string[];
  group?: boolean;
}

/**
 * One ranked theme hit: an id and public rank facts, nothing else. The RPC returns no caption,
 * tag, scene score or probability, and this shape must never grow one (the data project's data
 * boundary: those stay in its private `card_themes`).
 */
export interface ThemeHit {
  id: string;
  /** 0 = the game's showcase tier, 1 = other full art, 2 = windowed. */
  artBand: number;
  fullArt: boolean;
  /** The registry's type group key ('Amber', 'Dual ink', 'Red', 'Multicolour', 'DON!!', …). */
  typeGroup: string;
}

/**
 * One page of `theme_search`: the hits in server order (the order IS the ranking) and the true
 * total. `clamped`, `degraded` and `failed` mean exactly what they mean on SearchPage. `total`
 * counts theme + words + frame + type matches, before any device-only filter, and includes ids
 * this device's catalog may lack.
 */
export interface ThemePage {
  hits: ThemeHit[];
  total: number;
  clamped: boolean;
  degraded: boolean;
  failed: boolean;
}

/** Chip counts for a theme query: `frame` by 'full' / 'window', `type` by type group key. */
export interface ThemeFacetCounts {
  frame: Record<string, number>;
  type: Record<string, number>;
}

/** Raw row shape of `theme_search` (PostgREST, snake_case). The whole contract: five columns. */
interface ThemeRow {
  id: string;
  art_band: number | null;
  full_art: boolean | null;
  type_group: string | null;
  total_count: number | string;
}

/** The RPC's own page cap: a larger `p_limit` is cut to this server-side, so it is sent cut. */
const THEME_MAX_LIMIT = 1000;

/** The parameters `theme_search` and `theme_facets` share, in that order on the wire. */
function themeParams(game: string, q: ThemeQuery) {
  return {
    p_game: game,
    p_fields: q.themes.map((v) => ({ key: 'theme', value: v })),
    p_words: q.words,
    p_frame: q.frame && q.frame !== 'all' ? q.frame : null,
    p_types: q.types?.length ? q.types : null,
  };
}

/**
 * Rank a SECONDARY GAME'S theme query on the data project's `theme_search`, one page at a time.
 * The answer is ids in rank order plus the true total; map them onto the game's catalog rows with
 * `mergeThemeHits`. A game the data project has not enabled answers an empty page, like a query
 * that matches nothing.
 *
 * The paid path is searchCards' to the letter: a host proxy and a token take the body tagged
 * `rpc: 'theme_search'` (the host's endpoint forwards it unmetered); a 401/403 falls through to the
 * direct, metered call, and anything else that goes wrong there sets `degraded` on a clamped page.
 * A free (clamped) caller gets the top `free_theme_depth` hits by rank and the true total; the
 * server ignores `group` for it, so `mergeThemeHits` groups those few rows on the device.
 *
 * Fails soft: an empty page when server search is not configured, there is no game or no theme
 * term, or the language bound is contradictory (`languages: []`); `failed` when the server did not
 * answer.
 */
export async function searchThemes(
  game: string,
  q: ThemeQuery,
  { limit = 60, offset = 0, languages }: { limit?: number; offset?: number; languages?: CardLanguage[] } = {},
): Promise<ThemePage> {
  const empty: ThemePage = { hits: [], total: 0, clamped: false, degraded: false, failed: false };
  const failed: ThemePage = { ...empty, failed: true };
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  if (!(apiUrl && apiKey) || !game || q.themes.length === 0) return empty;
  if (languages?.length === 0) return empty; // contradictory bound (e.g. EN-only + lang:ja)
  const pageLimit = Math.min(Math.max(limit, 0), THEME_MAX_LIMIT);
  try {
    const params = {
      ...themeParams(game, q),
      p_group: !!q.group,
      p_limit: pageLimit,
      p_offset: offset,
      // Only sent when constrained, as in searchCards: absent means every language.
      ...(languages?.length ? { p_lang: languages } : {}),
    };
    let rows: ThemeRow[] | null = null;
    let viaProxy = false;
    /** The paid path was asked and BROKE (not refused). See `proxyBroke` in searchCards. */
    let proxyBroke = false;
    const proxy = getThemedSearchProxy();
    if (proxy) {
      // The host also learns the game, so it can give a theme away in one game and not another.
      const token = await proxy.getToken({ themes: q.themes, game }).catch(() => null);
      if (token) {
        try {
          const res = await fetch(proxy.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpc: 'theme_search', ...params }),
          });
          if (res.ok) {
            const answer: unknown = await res.json();
            if (Array.isArray(answer)) {
              rows = answer as ThemeRow[];
              viaProxy = true;
            } else {
              proxyBroke = true; // a 200 that is not rows: the endpoint is not answering this RPC
            }
          } else if (res.status !== 401 && res.status !== 403) {
            proxyBroke = true; // 5xx, a bad gateway, a function that predates theme_search (400)
          }
        } catch {
          rows = null; // the direct path answers
          proxyBroke = true; // offline, CORS, DNS: the endpoint did not get to have an opinion
        }
      }
    }
    if (!rows) {
      const res = await fetch(`${apiUrl}/rpc/theme_search`, {
        method: 'POST',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) return failed;
      const answer: unknown = await res.json();
      if (!Array.isArray(answer)) return failed;
      rows = answer as ThemeRow[];
    }
    if (!rows.length) return empty;
    const hits = rows.map(
      (r): ThemeHit => ({
        id: String(r.id),
        artBand: typeof r.art_band === 'number' ? r.art_band : 2,
        fullArt: r.full_art === true,
        typeGroup: r.type_group ?? '',
      }),
    );
    const total = Number(rows[0].total_count) || hits.length;
    // The meter, judged as searchCards judges it: the public free depth is the exact test, the
    // row count the fallback when that read failed. Only the direct path's page 0 can be clamped.
    const depth = viaProxy ? 0 : await freeThemeDepth();
    const clamped =
      !viaProxy && offset === 0 && ((depth > 0 && total > depth) || hits.length < Math.min(pageLimit, total));
    return { hits, total, clamped, degraded: clamped && proxyBroke, failed: false };
  } catch {
    return failed;
  }
}

/**
 * Chip counts for a secondary game's theme query (`theme_facets`), exclude-self: the frame counts
 * honour the type chips and ignore the frame; the type counts honour the frame and ignore the type
 * chips. A dual-ink or multicolour card counts under its group AND under each member, which is why
 * this cannot be counted from a page of ThemeHits on the device.
 *
 * Always the direct call: these are counts, not cards, so nothing here is metered by depth and the
 * paid path has nothing to add. `null` when the server did not answer (or is not configured): the
 * caller hides the counts and keeps the chips.
 */
export async function themeFacets(
  game: string,
  q: ThemeQuery,
  { languages }: { languages?: CardLanguage[] } = {},
): Promise<ThemeFacetCounts | null> {
  if (!serverSearchAvailable() || !game) return null;
  const counts: ThemeFacetCounts = { frame: {}, type: {} };
  if (q.themes.length === 0 || languages?.length === 0) return counts; // an answer: nothing matches
  try {
    const res = await fetch(`${getApiUrl()}/rpc/theme_facets`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...themeParams(game, q),
        // See searchCards: only sent when constrained.
        ...(languages?.length ? { p_lang: languages } : {}),
      }),
    });
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return null;
    for (const r of rows as { facet?: unknown; value?: unknown; n?: unknown }[]) {
      if ((r?.facet !== 'frame' && r?.facet !== 'type') || typeof r.value !== 'string' || !r.value) continue;
      counts[r.facet][r.value] = Number(r.n) || 0;
    }
    return counts;
  } catch {
    return null;
  }
}

/**
 * THE MERGE: `theme_search`'s ranked ids onto the device's own catalog rows, in server order.
 *
 * The server answers ids and rank facts; the tile, the price and every other filter come from the
 * game's public catalog.json, so a hit renders exactly like a browsed card. Each kept row is a copy
 * carrying the hit's `themeFullArt` and `themeGroup`. An id the catalog does not have is DROPPED (a
 * card published after this bundle, or another game's id, which the server never sends but the
 * merge does not take on trust), so the list can only show cards this device can render. `keep` is
 * the caller's pre-filter (the language bound). A repeated id (pages that overlapped while the data
 * changed) keeps its first, best-ranked place.
 *
 * `groupOrder` (the registry's type group keys, in display order) groups the rows HERE, with a
 * stable sort: rank order holds inside each group, and a group not in the list sorts last. Pass it
 * for a CLAMPED page with grouping on. The server ignores `group` for a free caller and returns the
 * best N by rank, never the best N of the first group; a paid page already arrives grouped.
 *
 * Pure (no fetch, no state), so a host or a check script can run it on fixtures.
 */
export function mergeThemeHits<T extends CatalogCard>(
  hits: readonly ThemeHit[],
  getCard: (id: string) => T | undefined,
  { keep, groupOrder }: { keep?: (card: T) => boolean; groupOrder?: readonly string[] } = {},
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const card = getCard(h.id);
    if (!card || (keep && !keep(card))) continue;
    merged.push({ ...card, themeFullArt: h.fullArt, themeGroup: h.typeGroup });
  }
  if (!groupOrder?.length) return merged;
  return groupByOrder(merged, groupOrder, (c) => c.themeGroup ?? '');
}

/** The card columns the direct PostgREST fetchers select (matches SearchRow minus cur/score). */
const CARD_COLS =
  'id,name,number,rarity,card_type,set_id,set_name,series,release_date,' +
  'illustrator,types,stage,hp,evolution_stage_index,evolves_from,evolution_line,jumbo,language';

/** PostgREST `&language=in.(...)` clause for a language constraint, or '' when unconstrained.
 *  Codes are the literal 'en'/'ja' enum values — safe unencoded in the in() list. */
function langClause(languages?: CardLanguage[]): string {
  return languages?.length ? `&language=in.(${languages.join(',')})` : '';
}

/** Per-set card cache for the cold drill-down (setId -> fetched, sorted cards). */
const setCardsCache = new Map<string, CatalogCard[]>();

/**
 * A set's browse-visible cards, straight from PostgREST (no catalog needed) — powers the
 * cold-mode Series → Set → Card drill-down. Sorted like the warm listCards (collector number,
 * then name); cached per set for the session. Fails soft (empty).
 */
export async function fetchSetCards(setId: string, languages?: CardLanguage[]): Promise<CatalogCard[]> {
  if (!serverSearchAvailable() || !setId) return [];
  const cacheKey = languages?.length ? `${setId}|${languages.join(',')}` : setId;
  const hit = setCardsCache.get(cacheKey);
  if (hit) return hit;
  try {
    const res = await fetch(
      `${getApiUrl()}/cards?select=${CARD_COLS}&set_id=eq.${encodeURIComponent(setId)}&browse_visible=is.true${langClause(languages)}&limit=1000`,
      { headers: { apikey: getApiKey() } },
    );
    if (!res.ok) return [];
    const cards = ((await res.json()) as SearchRow[])
      .map(rowToCard)
      .sort((a, b) => numberKey(a.number) - numberKey(b.number) || a.name.localeCompare(b.name));
    setCardsCache.set(cacheKey, cards);
    return cards;
  } catch {
    return [];
  }
}

/** Per-id card cache + in-flight coalescing for fetchCardsByIds (mirrors setCardsCache). */
const cardByIdCache = new Map<string, CatalogCard>();
const cardByIdInflight = new Map<string, Promise<void>>();

/**
 * REMEMBERING WHAT THE SERVER DOES NOT KNOW, which the positive caches above cannot express.
 *
 * Both id lookups here cached hits and forgot misses, so an id this server can never answer was
 * re-requested every single time it was asked for. That is not hypothetical: the card action sheet
 * calls `fetchCardDetail` on every open of a card with no evolution line, and for a card belonging
 * to ANOTHER GAME the Pokemon RPC cannot answer, ever — so opening the same card twenty times sent
 * twenty requests that were all going to fail, on a rate-limited endpoint, from a render path.
 *
 * A miss expires rather than being pinned for the session: an id can be genuinely absent today and
 * present after the next publish, and a collector who adds a brand-new card should not have to
 * relaunch the app to see it. Five minutes is long enough to kill a repaint storm and short enough
 * that nobody notices the wait.
 *
 * Only an ANSWER counts as a miss. A failed fetch, a non-OK response or a thrown request proves
 * nothing about the card and is left to retry — otherwise one flaky moment would hide a card until
 * the cooldown lapsed.
 */
const MISS_TTL_MS = 5 * 60_000;

function missCache() {
  const seenAt = new Map<string, number>();
  return {
    /** True while this id is known-absent and still inside the cooldown. */
    has(id: string): boolean {
      const at = seenAt.get(id);
      if (at === undefined) return false;
      if (Date.now() - at > MISS_TTL_MS) {
        seenAt.delete(id);
        return false;
      }
      return true;
    },
    /** Record that the server answered and did not have these ids. */
    add(ids: Iterable<string>, found: (id: string) => boolean): void {
      const now = Date.now();
      for (const id of ids) if (!found(id)) seenAt.set(id, now);
    },
  };
}

const cardByIdMisses = missCache();
const cardDetailMisses = missCache();

/**
 * Resolve specific card ids to tile-ready cards without the catalog (cold-mode similar
 * results, multi-select thumbs, …). Order follows the input ids. Fails soft (drops misses).
 * Cached per id for the session; concurrent callers coalesce onto one request, so the
 * browser's independent cold consumers (occupant effect, command handler, similar results)
 * share a single round-trip per id.
 */
export async function fetchCardsByIds(ids: string[]): Promise<CatalogCard[]> {
  if (!serverSearchAvailable() || ids.length === 0) return [];
  const misses = [...new Set(ids)].filter(
    (id) => !cardByIdCache.has(id) && !cardByIdInflight.has(id) && !cardByIdMisses.has(id),
  );
  if (misses.length > 0) {
    const req = (async () => {
      try {
        const list = misses.map(encodeURIComponent).join(',');
        const res = await fetch(`${getApiUrl()}/cards?select=${CARD_COLS}&id=in.(${list})`, {
          headers: { apikey: getApiKey() },
        });
        if (!res.ok) return;
        for (const r of (await res.json()) as SearchRow[]) {
          const card = rowToCard(r);
          cardByIdCache.set(card.id, card);
        }
        // The server answered: whatever it did not return, it does not have (for now).
        cardByIdMisses.add(misses, (id) => cardByIdCache.has(id));
      } catch {
        // fail soft — unresolved ids simply retry on the next call
      } finally {
        for (const id of misses) cardByIdInflight.delete(id);
      }
    })();
    for (const id of misses) cardByIdInflight.set(id, req);
  }
  await Promise.all(ids.map((id) => cardByIdInflight.get(id)));
  return ids.map((id) => cardByIdCache.get(id)).filter((c): c is CatalogCard => Boolean(c));
}

/**
 * Facet values (+counts) for the query's match set — restores the facet bar in COLD mode.
 * Exclude-self per facet (server-side), mirroring the warm facetOptions. Returns facet key →
 * values in server order (the kit re-orders for display). Fails soft (empty map).
 */
export async function searchFacets(
  parsedIn: ParsedQuery,
  facets?: ServerFacetSelection,
  boundIn?: CardLanguage[],
): Promise<Record<string, string[]>> {
  return (await searchFacetsWithCounts(parsedIn, facets, boundIn)).facets;
}

/**
 * `searchFacets` plus the POKEMON THEME TOOLBAR'S CHIP COUNTS, from the same single call.
 *
 * With a `toolbar`, a themed query's body carries its fields (themeToolbarFields), and any rows the
 * server answers under facet `frame` ('full' / 'window') or `tgroup` (a type group key) become
 * `counts`, meant exclude-self as theme_facets' are (frame counts ignore the frame, type counts
 * ignore the chips). Those rows are not facet chips, so they never reach `facets`. Today's
 * `search_facets` ignores the toolbar keys and answers no such rows: `counts` is then null and the
 * toolbar shows its chips without numbers. Without a toolbar the body is exactly searchFacets'.
 */
export async function searchFacetsWithCounts(
  parsedIn: ParsedQuery,
  facets?: ServerFacetSelection,
  boundIn?: CardLanguage[],
  toolbar?: ThemeToolbar,
): Promise<{ facets: Record<string, string[]>; counts: ThemeFacetCounts | null }> {
  const none = { facets: {}, counts: null };
  if (!serverSearchAvailable()) return none;
  const { parsed, languages } = foldLanguageTerms(parsedIn, boundIn);
  if (languages?.length === 0) return none;
  try {
    const res = await fetch(`${getApiUrl()}/rpc/search_facets`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_words: parsed.words,
        p_fields: fieldsWithToolbar(parsed, toolbar),
        p_compares: parsed.comparisons.map((c) => ({ field: c.field, op: c.op, value: c.value })),
        p_facets: packFacets(facets),
        p_min_price: parsed.minPrice,
        p_max_price: parsed.maxPrice,
        // See searchCards: only sent when constrained, for pre-migration compatibility.
        ...(languages?.length ? { p_lang: languages } : {}),
      }),
    });
    if (!res.ok) return none;
    const rows = (await res.json()) as { facet: string; value: string | null; n: number }[];
    const out: Record<string, string[]> = {};
    const counts: ThemeFacetCounts = { frame: {}, type: {} };
    let counted = false;
    for (const r of rows) {
      if (!r.value) continue;
      if (r.facet === 'frame' || r.facet === 'tgroup') {
        counts[r.facet === 'frame' ? 'frame' : 'type'][r.value] = Number(r.n) || 0;
        counted = true;
        continue;
      }
      (out[r.facet] ??= []).push(r.value);
    }
    return { facets: out, counts: toolbar && counted ? counts : null };
  } catch {
    return none;
  }
}

/**
 * Every card in the recent release window (release_date >= cutoff, upcoming included),
 * newest first — powers the catalog-FREE Recent & Upcoming feed. Fails soft ([]).
 */
/** Per-card heavy fields NOT shipped in the slim catalog — fetched on demand (rpc/card_detail,
 *  tcgscan-data migration 32). Today: the evolution line (only the card action sheet reads it). */
export interface CardDetail {
  evolvesFrom: string;
  evolutionLine: string[];
}

const cardDetailCache = new Map<string, CardDetail>();

/**
 * Resolve per-card detail fields by id (batched ≤50 per the RPC's cap, cached forever — the
 * fields are immutable per printing). Fails soft to whatever the cache already holds.
 */
export async function fetchCardDetail(ids: string[]): Promise<Record<string, CardDetail>> {
  const wanted = [...new Set(ids)];
  const misses = wanted.filter((id) => !cardDetailCache.has(id) && !cardDetailMisses.has(id));
  if (misses.length > 0 && serverSearchAvailable()) {
    // Only the ids actually sent can be judged; the rest stay unknown and are asked for next time.
    const asked = misses.slice(0, 50);
    try {
      const res = await fetch(`${getApiUrl()}/rpc/card_detail`, {
        method: 'POST',
        headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_ids: asked }),
      });
      if (res.ok) {
        for (const r of (await res.json()) as {
          id: string | number;
          evolves_from?: string | null;
          evolution_line?: string[] | null;
        }[]) {
          cardDetailCache.set(String(r.id), {
            evolvesFrom: r.evolves_from ?? '',
            evolutionLine: r.evolution_line ?? [],
          });
        }
        cardDetailMisses.add(asked, (id) => cardDetailCache.has(id));
      }
    } catch {
      // offline / not configured — evolution facts just stay absent
    }
  }
  const out: Record<string, CardDetail> = {};
  for (const id of wanted) {
    const d = cardDetailCache.get(id);
    if (d) out[id] = d;
  }
  return out;
}

export async function fetchRecentWindow(
  cutoff: string,
  languages?: CardLanguage[],
  limit = 1500,
): Promise<CatalogCard[]> {
  if (!serverSearchAvailable()) return [];
  try {
    const res = await fetch(
      `${getApiUrl()}/cards?select=${CARD_COLS}&release_date=gte.${cutoff}&browse_visible=is.true${langClause(languages)}&order=release_date.desc&limit=${limit}`,
      { headers: { apikey: getApiKey() } },
    );
    if (!res.ok) return [];
    return ((await res.json()) as SearchRow[]).map(rowToCard);
  } catch {
    return [];
  }
}

/** Set metadata for feed tiles (names, counts, official logos). The table is small (~200 rows). */
export interface SetMeta {
  id: string;
  name: string;
  series: string;
  cardCount: number;
  logoUrl: string;
}

export async function fetchSetMeta(): Promise<Map<string, SetMeta>> {
  if (!serverSearchAvailable()) return new Map();
  try {
    const res = await fetch(
      `${getApiUrl()}/sets?select=id,name,series,card_count,logo_url`,
      { headers: { apikey: getApiKey() } },
    );
    if (!res.ok) return new Map();
    const rows = (await res.json()) as {
      id: number;
      name: string | null;
      series: string | null;
      card_count: number | null;
      logo_url: string | null;
    }[];
    return new Map(
      rows.map((r) => [
        String(r.id),
        {
          id: String(r.id),
          name: r.name ?? '',
          series: r.series ?? '',
          cardCount: r.card_count ?? 0,
          logoUrl: r.logo_url ?? '',
        },
      ]),
    );
  } catch {
    return new Map();
  }
}
