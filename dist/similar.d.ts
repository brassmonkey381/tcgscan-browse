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
