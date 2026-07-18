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
import { numberKey, type CardKind, type CatalogCard } from './catalog';
import { getApiKey, getApiUrl } from './config';
import type { ParsedQuery } from './query';

/** One page of server results: tile-ready cards, their prices (by id), and the true total. */
export interface SearchPage {
  cards: CatalogCard[];
  /** Headline value per hit id (RPC `cur`), so cold-mode tiles/sort show prices without the
   *  price summary loaded. */
  priceById: Record<string, number>;
  /** Real match count for the whole query (RPC `total_count` window), for the results header. */
  total: number;
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
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages); `facets` are exact-match chip selections (AND across facets,
 * OR within). Returns tile-ready cards + their prices + the real total.
 */
export async function searchCards(
  parsed: ParsedQuery,
  {
    limit = 60,
    offset = 0,
    facets,
  }: { limit?: number; offset?: number; facets?: ServerFacetSelection } = {},
): Promise<SearchPage> {
  const empty: SearchPage = { cards: [], priceById: {}, total: 0 };
  if (!serverSearchAvailable()) return empty;
  try {
    const res = await fetch(`${getApiUrl()}/rpc/search_cards`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      }),
    });
    if (!res.ok) return empty;
    const rows = (await res.json()) as SearchRow[];
    if (!rows.length) return empty;
    const cards = rows.map(rowToCard);
    const priceById: Record<string, number> = {};
    for (const r of rows) priceById[String(r.id)] = Number(r.cur) || 0;
    return { cards, priceById, total: Number(rows[0].total_count) || cards.length };
  } catch {
    return empty; // offline / not configured — the caller falls back to client runQuery
  }
}

/** The card columns the direct PostgREST fetchers select (matches SearchRow minus cur/score). */
const CARD_COLS =
  'id,name,number,rarity,card_type,set_id,set_name,series,release_date,' +
  'illustrator,types,stage,hp,evolution_stage_index,evolves_from,evolution_line,jumbo';

/** Per-set card cache for the cold drill-down (setId -> fetched, sorted cards). */
const setCardsCache = new Map<string, CatalogCard[]>();

/**
 * A set's browse-visible cards, straight from PostgREST (no catalog needed) — powers the
 * cold-mode Series → Set → Card drill-down. Sorted like the warm listCards (collector number,
 * then name); cached per set for the session. Fails soft (empty).
 */
export async function fetchSetCards(setId: string): Promise<CatalogCard[]> {
  if (!serverSearchAvailable() || !setId) return [];
  const hit = setCardsCache.get(setId);
  if (hit) return hit;
  try {
    const res = await fetch(
      `${getApiUrl()}/cards?select=${CARD_COLS}&set_id=eq.${encodeURIComponent(setId)}&browse_visible=is.true&limit=1000`,
      { headers: { apikey: getApiKey() } },
    );
    if (!res.ok) return [];
    const cards = ((await res.json()) as SearchRow[])
      .map(rowToCard)
      .sort((a, b) => numberKey(a.number) - numberKey(b.number) || a.name.localeCompare(b.name));
    setCardsCache.set(setId, cards);
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
  parsed: ParsedQuery,
  facets?: ServerFacetSelection,
): Promise<Record<string, string[]>> {
  if (!serverSearchAvailable()) return {};
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
export async function fetchRecentWindow(cutoff: string, limit = 1500): Promise<CatalogCard[]> {
  if (!serverSearchAvailable()) return [];
  try {
    const res = await fetch(
      `${getApiUrl()}/cards?select=${CARD_COLS}&release_date=gte.${cutoff}&browse_visible=is.true&order=release_date.desc&limit=${limit}`,
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
