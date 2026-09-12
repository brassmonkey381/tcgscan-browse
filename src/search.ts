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
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages); `facets` are exact-match chip selections (AND across facets,
 * OR within). Returns tile-ready cards + their prices + the real total.
 */
export async function searchCards(
  parsedIn: ParsedQuery,
  {
    limit = 60,
    offset = 0,
    facets,
    languages: boundIn,
  }: { limit?: number; offset?: number; facets?: ServerFacetSelection; languages?: CardLanguage[] } = {},
): Promise<SearchPage> {
  const empty: SearchPage = { cards: [], priceById: {}, total: 0, clamped: false, degraded: false, failed: false };
  const failed: SearchPage = { ...empty, failed: true };
  if (!serverSearchAvailable()) return empty;
  const { parsed, languages } = foldLanguageTerms(parsedIn, boundIn);
  if (languages?.length === 0) return empty; // contradictory bound (e.g. EN-only + lang:ja)
  try {
    const body = JSON.stringify({
      p_words: parsed.words,
      p_fields: parsed.fields.map((f) => ({ key: f.key, value: f.value })),
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
    const proxy = themed ? getThemedSearchProxy() : null;
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
      const res = await fetch(`${getApiUrl()}/rpc/search_cards`, {
        method: 'POST',
        headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
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
    const depth = themed && !viaProxy ? await freeThemeDepth() : 0;
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
 * Resolve specific card ids to tile-ready cards without the catalog (cold-mode similar
 * results, multi-select thumbs, …). Order follows the input ids. Fails soft (drops misses).
 * Cached per id for the session; concurrent callers coalesce onto one request, so the
 * browser's independent cold consumers (occupant effect, command handler, similar results)
 * share a single round-trip per id.
 */
export async function fetchCardsByIds(ids: string[]): Promise<CatalogCard[]> {
  if (!serverSearchAvailable() || ids.length === 0) return [];
  const misses = [...new Set(ids)].filter(
    (id) => !cardByIdCache.has(id) && !cardByIdInflight.has(id),
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
  if (!serverSearchAvailable()) return {};
  const { parsed, languages } = foldLanguageTerms(parsedIn, boundIn);
  if (languages?.length === 0) return {};
  try {
    const res = await fetch(`${getApiUrl()}/rpc/search_facets`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_words: parsed.words,
        p_fields: parsed.fields.map((f) => ({ key: f.key, value: f.value })),
        p_compares: parsed.comparisons.map((c) => ({ field: c.field, op: c.op, value: c.value })),
        p_facets: packFacets(facets),
        p_min_price: parsed.minPrice,
        p_max_price: parsed.maxPrice,
        // See searchCards: only sent when constrained, for pre-migration compatibility.
        ...(languages?.length ? { p_lang: languages } : {}),
      }),
    });
    if (!res.ok) return {};
    const rows = (await res.json()) as { facet: string; value: string | null; n: number }[];
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      if (!r.value) continue;
      (out[r.facet] ??= []).push(r.value);
    }
    return out;
  } catch {
    return {};
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
  const misses = wanted.filter((id) => !cardDetailCache.has(id));
  if (misses.length > 0 && serverSearchAvailable()) {
    try {
      const res = await fetch(`${getApiUrl()}/rpc/card_detail`, {
        method: 'POST',
        headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_ids: misses.slice(0, 50) }),
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
