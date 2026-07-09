/**
 * Visual similarity — the data server's find_similar RPC (pgvector over the
 * scanner's 64-d card embeddings). Given a catalog card id, returns the ids of
 * the most visually similar cards; the caller resolves them against the local
 * catalog for display. Fails soft (empty list) — similarity is a bonus feature,
 * never a dependency.
 */
import { getApiKey, getApiUrl } from './config';
/** True when the app is configured to reach the data server's REST API. */
export function similarAvailable() {
    return Boolean(getApiUrl() && getApiKey());
}
export async function findSimilar(cardId, limit = 24) {
    if (!similarAvailable())
        return [];
    try {
        const res = await fetch(`${getApiUrl()}/rpc/find_similar`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_card_id: cardId, p_limit: limit }),
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
export async function findSimilarToMany(cardIds, limit = 24) {
    if (!similarAvailable() || cardIds.length === 0)
        return [];
    try {
        const res = await fetch(`${getApiUrl()}/rpc/find_similar_to_cards`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_card_ids: cardIds, p_limit: limit }),
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
