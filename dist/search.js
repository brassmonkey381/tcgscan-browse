import { getApiKey, getApiUrl } from './config';
/** True when the app is configured to reach the data server's REST API. */
export function serverSearchAvailable() {
    return Boolean(getApiUrl() && getApiKey());
}
/** Map an RPC row to a CatalogCard so it renders through the same tile/sheet as warm results. */
function rowToCard(r) {
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
        kind: (r.jumbo ? 'jumbo' : 'standard'),
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
export async function searchCards(parsed, { limit = 60, offset = 0 } = {}) {
    const empty = { cards: [], priceById: {}, total: 0 };
    if (!serverSearchAvailable())
        return empty;
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
        if (!res.ok)
            return empty;
        const rows = (await res.json());
        if (!rows.length)
            return empty;
        const cards = rows.map(rowToCard);
        const priceById = {};
        for (const r of rows)
            priceById[String(r.id)] = Number(r.cur) || 0;
        return { cards, priceById, total: Number(rows[0].total_count) || cards.length };
    }
    catch {
        return empty; // offline / not configured — the caller falls back to client runQuery
    }
}
