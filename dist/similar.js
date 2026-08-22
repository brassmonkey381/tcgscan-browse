import { getApiKey, getApiUrl } from './config';
import { effectiveLanguages } from './language';
/**
 * `p_lang` body fragment for a language bound.
 *
 * Every similarity call takes an optional `languages`; omitting it inherits the shared EN/JP
 * preference (see `language.ts`). The bound is applied SERVER-SIDE, before the top-N cut, so a
 * constrained search returns a full `limit` of in-language cards rather than a page thinned by
 * client-side filtering (measured: 46.7% of an EN card's 24 nearest neighbours are JP printings).
 *
 * The SEED card is never language-bound — you can sit on a Japanese card and ask for English
 * neighbours; only the results are constrained.
 *
 * Omitted entirely when unconstrained, so the RPC keeps its cheaper unbounded plan and a server
 * predating tcgscan-data migration 33 still answers.
 */
function langArg(languages) {
    const eff = effectiveLanguages(languages);
    return eff ? { p_lang: eff } : {};
}
/** How long a similarity RPC may run before we abort and fail soft. A hung request without
 *  this left the browser's "Searching…" placeholder up forever. */
const RPC_TIMEOUT_MS = 12000;
/** fetch that always settles: aborts after RPC_TIMEOUT_MS (AbortSignal.timeout isn't
 *  available on all RN runtimes, so wire the controller by hand). */
function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
/** True when the app is configured to reach the data server's REST API. */
export function similarAvailable() {
    return Boolean(getApiUrl() && getApiKey());
}
/**
 * WHICH EMBEDDING MODEL ANSWERS. `null` (the default) is the LIVE model — the one whose vectors
 * sit in cards.embedding and which every user gets. Anything else is a CANDIDATE: a model pushed
 * to card_embeddings_candidate for evaluation, reachable only through the *_candidate RPCs, with
 * no effect on what anyone else sees.
 *
 * This is an evaluation control, not a preference. Two models rank differently on ordinary cards
 * (measured: 2 of 5 shared neighbours on a mid-catalog seed) while agreeing almost completely on
 * reprint clusters, and no offline bench answers which is the better *browse* neighbour — that is
 * a human judgement on real seeds, which is what this exists to enable.
 *
 * Module-level rather than per-call so every similarity path in a session answers from one space:
 * a seed search on capG-e15 followed by a refinement on the live model would silently compare two
 * geometries and read as one result set.
 */
let similarityModel = null;
export function setSimilarityModel(modelVersion) {
    similarityModel = modelVersion || null;
}
export function getSimilarityModel() {
    return similarityModel;
}
/**
 * Candidate models available to compare against, newest first. The live model is NOT in this list
 * — it is `null`, the default — so a picker should offer "Live" plus whatever this returns.
 * Fails soft to an empty list, which correctly renders as "live only" on a server that predates
 * the candidate_embeddings migration.
 */
export async function listSimilarityModels() {
    if (!similarAvailable())
        return [];
    try {
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/list_candidate_models`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: '{}',
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({
            modelVersion: r.model_version,
            nVectors: r.n_vectors,
            languages: r.languages ?? [],
            createdAt: r.created_at,
        }));
    }
    catch {
        return [];
    }
}
/**
 * (rpc name, extra body) for the active model.
 *
 * Every similarity call routes through this, so a model can never be selected for one path and
 * silently ignored on another — the failure a picker over `findSimilar` alone would have had, with
 * the seed search on the candidate and the refinement back on live under one label.
 */
function route(liveRpc) {
    return similarityModel
        ? { rpc: `${liveRpc}_candidate`, extra: { p_model_version: similarityModel } }
        : { rpc: liveRpc, extra: {} };
}
export async function findSimilar(cardId, limit = 24, { languages } = {}) {
    if (!similarAvailable())
        return [];
    try {
        const { rpc, extra } = route('find_similar');
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/${rpc}`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_card_id: cardId, p_limit: limit, ...extra, ...langArg(languages) }),
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({ id: r.id, similarity: r.similarity }));
    }
    catch {
        return [];
    }
}
/**
 * Multi-select "find similar to all": the ids most visually similar to the AVERAGE
 * embedding of `cardIds`. The server (find_similar_to_cards RPC) resolves each id's
 * 64-d vector, means them, and returns nearest neighbors — the client never holds
 * embeddings. Fails soft (empty list). Requires the find_similar_to_cards migration.
 */
export async function findSimilarToMany(cardIds, limit = 24, { languages } = {}) {
    if (!similarAvailable() || cardIds.length === 0)
        return [];
    try {
        const { rpc, extra } = route('find_similar_to_cards');
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/${rpc}`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_card_ids: cardIds, p_limit: limit, ...extra, ...langArg(languages) }),
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({ id: r.id, similarity: r.similarity }));
    }
    catch {
        return [];
    }
}
// Rocchio relevance-feedback coefficients: the seed keeps full weight, each "more like this"
// group pulls with β, each "less like this" group pushes with γ. A group's coefficient is
// split across its members so a 5-card refinement doesn't out-shout a 1-card seed.
const STEP_COEF = { seed: 1.0, more: 0.8, less: -0.5 };
/**
 * Flatten a refinement session into parallel (ids, weights) arrays for
 * `find_similar_weighted` — per-card weight = its group's coefficient / group size, summed
 * when a card appears in several steps (e.g. marked "more" twice).
 */
export function refineWeights(steps) {
    const byId = new Map();
    for (const step of steps) {
        if (step.ids.length === 0)
            continue;
        const w = STEP_COEF[step.kind] / step.ids.length;
        for (const id of step.ids)
            byId.set(id, (byId.get(id) ?? 0) + w);
    }
    return { ids: [...byId.keys()], weights: [...byId.values()] };
}
/**
 * Refinement search: nearest neighbours of the WEIGHTED combination of the session's card
 * embeddings (find_similar_weighted RPC — Rocchio over the whole more/less history; the
 * client never holds embeddings). Session ids are excluded server-side. Fails soft.
 */
export async function findSimilarWeighted(steps, limit = 24, { languages } = {}) {
    const { ids, weights } = refineWeights(steps);
    if (!similarAvailable() || ids.length === 0)
        return [];
    try {
        const { rpc, extra } = route('find_similar_weighted');
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/${rpc}`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
                p_card_ids: ids,
                p_weights: weights,
                p_limit: limit,
                ...extra,
                ...langArg(languages),
            }),
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({ id: r.id, similarity: r.similarity }));
    }
    catch {
        return [];
    }
}
