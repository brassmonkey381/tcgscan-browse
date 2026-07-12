/**
 * Visual similarity — the data server's find_similar RPC (pgvector over the
 * scanner's 64-d card embeddings). Given a catalog card id, returns the ids of
 * the most visually similar cards; the caller resolves them against the local
 * catalog for display. Fails soft (empty list) — similarity is a bonus feature,
 * never a dependency.
 */
import { getApiKey, getApiUrl } from './config';

export interface SimilarHit {
  id: string;
  similarity: number; // cosine, 0..1-ish (higher = closer)
}

/** True when the app is configured to reach the data server's REST API. */
export function similarAvailable(): boolean {
  return Boolean(getApiUrl() && getApiKey());
}

export async function findSimilar(cardId: string, limit = 24): Promise<SimilarHit[]> {
  if (!similarAvailable()) return [];
  try {
    const res = await fetch(`${getApiUrl()}/rpc/find_similar`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_card_id: cardId, p_limit: limit }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { id: string; similarity: number }[];
    return rows.map((r) => ({ id: r.id, similarity: r.similarity }));
  } catch {
    return [];
  }
}

/**
 * Multi-select "find similar to all": the ids most visually similar to the AVERAGE
 * embedding of `cardIds`. The server (find_similar_to_cards RPC) resolves each id's
 * 64-d vector, means them, and returns nearest neighbors — the client never holds
 * embeddings. Fails soft (empty list). Requires the find_similar_to_cards migration.
 */
export async function findSimilarToMany(cardIds: string[], limit = 24): Promise<SimilarHit[]> {
  if (!similarAvailable() || cardIds.length === 0) return [];
  try {
    const res = await fetch(`${getApiUrl()}/rpc/find_similar_to_cards`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_card_ids: cardIds, p_limit: limit }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { id: string; similarity: number }[];
    return rows.map((r) => ({ id: r.id, similarity: r.similarity }));
  } catch {
    return [];
  }
}

/** One step of an ongoing similarity session: the seed search, then each refinement. */
export interface SimilarStep {
  kind: 'seed' | 'more' | 'less';
  ids: string[];
}

// Rocchio relevance-feedback coefficients: the seed keeps full weight, each "more like this"
// group pulls with β, each "less like this" group pushes with γ. A group's coefficient is
// split across its members so a 5-card refinement doesn't out-shout a 1-card seed.
const STEP_COEF: Record<SimilarStep['kind'], number> = { seed: 1.0, more: 0.8, less: -0.5 };

/**
 * Flatten a refinement session into parallel (ids, weights) arrays for
 * `find_similar_weighted` — per-card weight = its group's coefficient / group size, summed
 * when a card appears in several steps (e.g. marked "more" twice).
 */
export function refineWeights(steps: SimilarStep[]): { ids: string[]; weights: number[] } {
  const byId = new Map<string, number>();
  for (const step of steps) {
    if (step.ids.length === 0) continue;
    const w = STEP_COEF[step.kind] / step.ids.length;
    for (const id of step.ids) byId.set(id, (byId.get(id) ?? 0) + w);
  }
  return { ids: [...byId.keys()], weights: [...byId.values()] };
}

/**
 * Refinement search: nearest neighbours of the WEIGHTED combination of the session's card
 * embeddings (find_similar_weighted RPC — Rocchio over the whole more/less history; the
 * client never holds embeddings). Session ids are excluded server-side. Fails soft.
 */
export async function findSimilarWeighted(steps: SimilarStep[], limit = 24): Promise<SimilarHit[]> {
  const { ids, weights } = refineWeights(steps);
  if (!similarAvailable() || ids.length === 0) return [];
  try {
    const res = await fetch(`${getApiUrl()}/rpc/find_similar_weighted`, {
      method: 'POST',
      headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_card_ids: ids, p_weights: weights, p_limit: limit }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { id: string; similarity: number }[];
    return rows.map((r) => ({ id: r.id, similarity: r.similarity }));
  } catch {
    return [];
  }
}
