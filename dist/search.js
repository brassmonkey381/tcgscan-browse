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
import { numberKey } from './catalog';
import { getApiKey, getApiUrl, getThemedSearchProxy } from './config';
/**
 * The free depth of a themed query, read once from the data project's public `search_config`.
 * Public precisely so the meter can be EXACT: "clamped" is `total > depth`, not an inference
 * from the row count, which misses a page size at or under the depth. 0 (or unreadable) means
 * the meter is off and the row-count fallback in searchCards is the only signal.
 */
let depthPromise = null;
export function freeThemeDepth() {
    if (!depthPromise) {
        depthPromise = fetch(`${getApiUrl()}/search_config?select=free_theme_depth&limit=1`, {
            headers: { apikey: getApiKey() },
        })
            .then((r) => (r.ok ? r.json() : []))
            .then((rows) => Number(rows?.[0]?.free_theme_depth) || 0)
            .catch(() => 0);
    }
    return depthPromise;
}
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
        language: r.language === 'ja' ? 'ja' : 'en',
        fullArtKind: r.full_art_kind ?? '',
    };
}
/** Drop empty entries so `{}` (no selection) skips the facet filter entirely server-side. */
function packFacets(facets) {
    const out = {};
    for (const [k, v] of Object.entries(facets ?? {}))
        if (v.length > 0)
            out[k] = v;
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
function foldLanguageTerms(parsed, bound) {
    const asked = parsed.fields.filter((f) => f.key === 'lang').map((f) => f.value);
    if (asked.length === 0)
        return { parsed, languages: bound };
    const wanted = asked.filter((v) => v === 'en' || v === 'ja');
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
export async function searchCards(parsedIn, { limit = 60, offset = 0, facets, languages: boundIn, } = {}) {
    const empty = { cards: [], priceById: {}, total: 0, clamped: false, degraded: false };
    if (!serverSearchAvailable())
        return empty;
    const { parsed, languages } = foldLanguageTerms(parsedIn, boundIn);
    if (languages?.length === 0)
        return empty; // contradictory bound (e.g. EN-only + lang:ja)
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
        let rows = null;
        let viaProxy = false;
        let proxyTried = false;
        const proxy = themed ? getThemedSearchProxy() : null;
        if (proxy) {
            const token = await proxy.getToken().catch(() => null);
            if (token) {
                proxyTried = true;
                try {
                    const res = await fetch(proxy.url, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body,
                    });
                    if (res.ok) {
                        rows = (await res.json());
                        viaProxy = true;
                    }
                }
                catch {
                    rows = null; // the direct path answers
                }
            }
        }
        if (!rows) {
            const res = await fetch(`${getApiUrl()}/rpc/search_cards`, {
                method: 'POST',
                headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
                body,
            });
            if (!res.ok)
                return empty;
            rows = (await res.json());
        }
        if (!rows.length)
            return empty;
        const cards = rows.map(rowToCard);
        const priceById = {};
        for (const r of rows)
            priceById[String(r.id)] = Number(r.cur) || 0;
        const total = Number(rows[0].total_count) || cards.length;
        // Depth-limited: the public free depth is the exact test (`total > depth`), and the row
        // count is the fallback for when that read failed — an unclamped first page of `limit` over
        // `total` matches is min(limit, total) rows long, so a shorter one was cut. Only a themed
        // query on the direct path can be clamped; only page 0 is judged (the server pins it anyway).
        const depth = themed && !viaProxy ? await freeThemeDepth() : 0;
        const clamped = themed && !viaProxy && offset === 0
            && ((depth > 0 && total > depth) || cards.length < Math.min(limit, total));
        return { cards, priceById, total, clamped, degraded: clamped && proxyTried };
    }
    catch {
        return empty; // offline / not configured, the caller falls back to client runQuery
    }
}
/** The card columns the direct PostgREST fetchers select (matches SearchRow minus cur/score). */
const CARD_COLS = 'id,name,number,rarity,card_type,set_id,set_name,series,release_date,' +
    'illustrator,types,stage,hp,evolution_stage_index,evolves_from,evolution_line,jumbo,language';
/** PostgREST `&language=in.(...)` clause for a language constraint, or '' when unconstrained.
 *  Codes are the literal 'en'/'ja' enum values — safe unencoded in the in() list. */
function langClause(languages) {
    return languages?.length ? `&language=in.(${languages.join(',')})` : '';
}
/** Per-set card cache for the cold drill-down (setId -> fetched, sorted cards). */
const setCardsCache = new Map();
/**
 * A set's browse-visible cards, straight from PostgREST (no catalog needed) — powers the
 * cold-mode Series → Set → Card drill-down. Sorted like the warm listCards (collector number,
 * then name); cached per set for the session. Fails soft (empty).
 */
export async function fetchSetCards(setId, languages) {
    if (!serverSearchAvailable() || !setId)
        return [];
    const cacheKey = languages?.length ? `${setId}|${languages.join(',')}` : setId;
    const hit = setCardsCache.get(cacheKey);
    if (hit)
        return hit;
    try {
        const res = await fetch(`${getApiUrl()}/cards?select=${CARD_COLS}&set_id=eq.${encodeURIComponent(setId)}&browse_visible=is.true${langClause(languages)}&limit=1000`, { headers: { apikey: getApiKey() } });
        if (!res.ok)
            return [];
        const cards = (await res.json())
            .map(rowToCard)
            .sort((a, b) => numberKey(a.number) - numberKey(b.number) || a.name.localeCompare(b.name));
        setCardsCache.set(cacheKey, cards);
        return cards;
    }
    catch {
        return [];
    }
}
/** Per-id card cache + in-flight coalescing for fetchCardsByIds (mirrors setCardsCache). */
const cardByIdCache = new Map();
const cardByIdInflight = new Map();
/**
 * Resolve specific card ids to tile-ready cards without the catalog (cold-mode similar
 * results, multi-select thumbs, …). Order follows the input ids. Fails soft (drops misses).
 * Cached per id for the session; concurrent callers coalesce onto one request, so the
 * browser's independent cold consumers (occupant effect, command handler, similar results)
 * share a single round-trip per id.
 */
export async function fetchCardsByIds(ids) {
    if (!serverSearchAvailable() || ids.length === 0)
        return [];
    const misses = [...new Set(ids)].filter((id) => !cardByIdCache.has(id) && !cardByIdInflight.has(id));
    if (misses.length > 0) {
        const req = (async () => {
            try {
                const list = misses.map(encodeURIComponent).join(',');
                const res = await fetch(`${getApiUrl()}/cards?select=${CARD_COLS}&id=in.(${list})`, {
                    headers: { apikey: getApiKey() },
                });
                if (!res.ok)
                    return;
                for (const r of (await res.json())) {
                    const card = rowToCard(r);
                    cardByIdCache.set(card.id, card);
                }
            }
            catch {
                // fail soft — unresolved ids simply retry on the next call
            }
            finally {
                for (const id of misses)
                    cardByIdInflight.delete(id);
            }
        })();
        for (const id of misses)
            cardByIdInflight.set(id, req);
    }
    await Promise.all(ids.map((id) => cardByIdInflight.get(id)));
    return ids.map((id) => cardByIdCache.get(id)).filter((c) => Boolean(c));
}
/**
 * Facet values (+counts) for the query's match set — restores the facet bar in COLD mode.
 * Exclude-self per facet (server-side), mirroring the warm facetOptions. Returns facet key →
 * values in server order (the kit re-orders for display). Fails soft (empty map).
 */
export async function searchFacets(parsedIn, facets, boundIn) {
    var _a;
    if (!serverSearchAvailable())
        return {};
    const { parsed, languages } = foldLanguageTerms(parsedIn, boundIn);
    if (languages?.length === 0)
        return {};
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
        if (!res.ok)
            return {};
        const rows = (await res.json());
        const out = {};
        for (const r of rows) {
            if (!r.value)
                continue;
            (out[_a = r.facet] ?? (out[_a] = [])).push(r.value);
        }
        return out;
    }
    catch {
        return {};
    }
}
const cardDetailCache = new Map();
/**
 * Resolve per-card detail fields by id (batched ≤50 per the RPC's cap, cached forever — the
 * fields are immutable per printing). Fails soft to whatever the cache already holds.
 */
export async function fetchCardDetail(ids) {
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
                for (const r of (await res.json())) {
                    cardDetailCache.set(String(r.id), {
                        evolvesFrom: r.evolves_from ?? '',
                        evolutionLine: r.evolution_line ?? [],
                    });
                }
            }
        }
        catch {
            // offline / not configured — evolution facts just stay absent
        }
    }
    const out = {};
    for (const id of wanted) {
        const d = cardDetailCache.get(id);
        if (d)
            out[id] = d;
    }
    return out;
}
export async function fetchRecentWindow(cutoff, languages, limit = 1500) {
    if (!serverSearchAvailable())
        return [];
    try {
        const res = await fetch(`${getApiUrl()}/cards?select=${CARD_COLS}&release_date=gte.${cutoff}&browse_visible=is.true${langClause(languages)}&order=release_date.desc&limit=${limit}`, { headers: { apikey: getApiKey() } });
        if (!res.ok)
            return [];
        return (await res.json()).map(rowToCard);
    }
    catch {
        return [];
    }
}
export async function fetchSetMeta() {
    if (!serverSearchAvailable())
        return new Map();
    try {
        const res = await fetch(`${getApiUrl()}/sets?select=id,name,series,card_count,logo_url`, { headers: { apikey: getApiKey() } });
        if (!res.ok)
            return new Map();
        const rows = (await res.json());
        return new Map(rows.map((r) => [
            String(r.id),
            {
                id: String(r.id),
                name: r.name ?? '',
                series: r.series ?? '',
                cardCount: r.card_count ?? 0,
                logoUrl: r.logo_url ?? '',
            },
        ]));
    }
    catch {
        return new Map();
    }
}
