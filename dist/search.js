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
 * A SECONDARY GAME (Lorcana, One Piece) has no `search_cards`; its themed queries go to
 * `theme_search` / `theme_facets` (tcgscan-data migration 79) through `searchThemes` /
 * `themeFacets` below, which answer ranked ids only. `mergeThemeHits` maps them onto the game's
 * own public catalog rows, and the rest of the query runs on the device over those.
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
/**
 * Internal: forget every server-search cache (resetBrowseData). They are keyed by card and set id,
 * and ids are one namespace across games, but a set's card list and a card's detail come from the
 * configured api, which the host has just changed.
 */
export function _resetSearchCaches() {
    depthPromise = null;
    setCardsCache.clear();
    cardByIdCache.clear();
    cardByIdInflight.clear();
    cardDetailCache.clear();
}
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
 *
 * `api` searches that endpoint instead of the configured one. Nothing else about the configured
 * game applies to it: the host's themed-search proxy and the free theme depth belong to the
 * configured game, so neither is used, and a themed query is judged by its row count alone.
 */
export async function searchCards(parsedIn, { limit = 60, offset = 0, facets, languages: boundIn, api, } = {}) {
    const empty = { cards: [], priceById: {}, total: 0, clamped: false, degraded: false, failed: false };
    const failed = { ...empty, failed: true };
    const apiUrl = api ? api.url : getApiUrl();
    const apiKey = api ? api.key : getApiKey();
    if (!(apiUrl && apiKey))
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
                        rows = (await res.json());
                        viaProxy = true;
                    }
                    else if (res.status !== 401 && res.status !== 403) {
                        proxyBroke = true; // 5xx, a bad gateway, a misconfigured function
                    }
                }
                catch {
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
            if (!res.ok)
                return failed;
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
        const depth = themed && !viaProxy && !api ? await freeThemeDepth() : 0;
        const clamped = themed && !viaProxy && offset === 0
            && ((depth > 0 && total > depth) || cards.length < Math.min(limit, total));
        return { cards, priceById, total, clamped, degraded: clamped && proxyBroke, failed: false };
    }
    catch {
        // Offline, DNS, CORS, a body that is not JSON. There is no local fallback for a cold search
        // (no catalog to run the query over), so the caller says the server did not answer.
        return failed;
    }
}
/** The RPC's own page cap: a larger `p_limit` is cut to this server-side, so it is sent cut. */
const THEME_MAX_LIMIT = 1000;
/** The parameters `theme_search` and `theme_facets` share, in that order on the wire. */
function themeParams(game, q) {
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
export async function searchThemes(game, q, { limit = 60, offset = 0, languages } = {}) {
    const empty = { hits: [], total: 0, clamped: false, degraded: false, failed: false };
    const failed = { ...empty, failed: true };
    const apiUrl = getApiUrl();
    const apiKey = getApiKey();
    if (!(apiUrl && apiKey) || !game || q.themes.length === 0)
        return empty;
    if (languages?.length === 0)
        return empty; // contradictory bound (e.g. EN-only + lang:ja)
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
        let rows = null;
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
                        const answer = await res.json();
                        if (Array.isArray(answer)) {
                            rows = answer;
                            viaProxy = true;
                        }
                        else {
                            proxyBroke = true; // a 200 that is not rows: the endpoint is not answering this RPC
                        }
                    }
                    else if (res.status !== 401 && res.status !== 403) {
                        proxyBroke = true; // 5xx, a bad gateway, a function that predates theme_search (400)
                    }
                }
                catch {
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
            if (!res.ok)
                return failed;
            const answer = await res.json();
            if (!Array.isArray(answer))
                return failed;
            rows = answer;
        }
        if (!rows.length)
            return empty;
        const hits = rows.map((r) => ({
            id: String(r.id),
            artBand: typeof r.art_band === 'number' ? r.art_band : 2,
            fullArt: r.full_art === true,
            typeGroup: r.type_group ?? '',
        }));
        const total = Number(rows[0].total_count) || hits.length;
        // The meter, judged as searchCards judges it: the public free depth is the exact test, the
        // row count the fallback when that read failed. Only the direct path's page 0 can be clamped.
        const depth = viaProxy ? 0 : await freeThemeDepth();
        const clamped = !viaProxy && offset === 0 && ((depth > 0 && total > depth) || hits.length < Math.min(pageLimit, total));
        return { hits, total, clamped, degraded: clamped && proxyBroke, failed: false };
    }
    catch {
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
export async function themeFacets(game, q, { languages } = {}) {
    if (!serverSearchAvailable() || !game)
        return null;
    const counts = { frame: {}, type: {} };
    if (q.themes.length === 0 || languages?.length === 0)
        return counts; // an answer: nothing matches
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
        if (!res.ok)
            return null;
        const rows = await res.json();
        if (!Array.isArray(rows))
            return null;
        for (const r of rows) {
            if ((r?.facet !== 'frame' && r?.facet !== 'type') || typeof r.value !== 'string' || !r.value)
                continue;
            counts[r.facet][r.value] = Number(r.n) || 0;
        }
        return counts;
    }
    catch {
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
export function mergeThemeHits(hits, getCard, { keep, groupOrder } = {}) {
    const seen = new Set();
    const merged = [];
    for (const h of hits) {
        if (seen.has(h.id))
            continue;
        seen.add(h.id);
        const card = getCard(h.id);
        if (!card || (keep && !keep(card)))
            continue;
        merged.push({ ...card, themeFullArt: h.fullArt, themeGroup: h.typeGroup });
    }
    if (!groupOrder?.length)
        return merged;
    const order = new Map(groupOrder.map((key, i) => [key, i]));
    const groupOf = (c) => order.get(c.themeGroup ?? '') ?? order.size;
    return merged
        .map((c, i) => [c, i])
        .sort((a, b) => groupOf(a[0]) - groupOf(b[0]) || a[1] - b[1])
        .map(([c]) => c);
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
const MISS_TTL_MS = 5 * 60000;
function missCache() {
    const seenAt = new Map();
    return {
        /** True while this id is known-absent and still inside the cooldown. */
        has(id) {
            const at = seenAt.get(id);
            if (at === undefined)
                return false;
            if (Date.now() - at > MISS_TTL_MS) {
                seenAt.delete(id);
                return false;
            }
            return true;
        },
        /** Record that the server answered and did not have these ids. */
        add(ids, found) {
            const now = Date.now();
            for (const id of ids)
                if (!found(id))
                    seenAt.set(id, now);
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
export async function fetchCardsByIds(ids) {
    if (!serverSearchAvailable() || ids.length === 0)
        return [];
    const misses = [...new Set(ids)].filter((id) => !cardByIdCache.has(id) && !cardByIdInflight.has(id) && !cardByIdMisses.has(id));
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
                // The server answered: whatever it did not return, it does not have (for now).
                cardByIdMisses.add(misses, (id) => cardByIdCache.has(id));
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
                for (const r of (await res.json())) {
                    cardDetailCache.set(String(r.id), {
                        evolvesFrom: r.evolves_from ?? '',
                        evolutionLine: r.evolution_line ?? [],
                    });
                }
                cardDetailMisses.add(asked, (id) => cardDetailCache.has(id));
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
