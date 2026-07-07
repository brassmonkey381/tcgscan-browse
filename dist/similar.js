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
