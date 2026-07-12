export interface SimilarHit {
    id: string;
    similarity: number;
}
/** True when the app is configured to reach the data server's REST API. */
export declare function similarAvailable(): boolean;
export declare function findSimilar(cardId: string, limit?: number): Promise<SimilarHit[]>;
/**
 * Multi-select "find similar to all": the ids most visually similar to the AVERAGE
 * embedding of `cardIds`. The server (find_similar_to_cards RPC) resolves each id's
 * 64-d vector, means them, and returns nearest neighbors — the client never holds
 * embeddings. Fails soft (empty list). Requires the find_similar_to_cards migration.
 */
export declare function findSimilarToMany(cardIds: string[], limit?: number): Promise<SimilarHit[]>;
/** One step of an ongoing similarity session: the seed search, then each refinement. */
export interface SimilarStep {
    kind: 'seed' | 'more' | 'less';
    ids: string[];
}
/**
 * Flatten a refinement session into parallel (ids, weights) arrays for
 * `find_similar_weighted` — per-card weight = its group's coefficient / group size, summed
 * when a card appears in several steps (e.g. marked "more" twice).
 */
export declare function refineWeights(steps: SimilarStep[]): {
    ids: string[];
    weights: number[];
};
/**
 * Refinement search: nearest neighbours of the WEIGHTED combination of the session's card
 * embeddings (find_similar_weighted RPC — Rocchio over the whole more/less history; the
 * client never holds embeddings). Session ids are excluded server-side. Fails soft.
 */
export declare function findSimilarWeighted(steps: SimilarStep[], limit?: number): Promise<SimilarHit[]>;
