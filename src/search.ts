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
import type { CardKind, CatalogCard } from './catalog';
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
  };
}

/**
 * Run `parsed` against the server, one page at a time. `offset`/`limit` drive infinite scroll
 * (the caller accumulates pages). Returns tile-ready cards + their prices + the real total.
 */
export async function searchCards(
  parsed: ParsedQuery,
  { limit = 60, offset = 0 }: { limit?: number; offset?: number } = {},
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
