export interface SimilarHit {
    id: string;
    similarity: number;
}
/** True when the app is configured to reach the data server's REST API. */
export declare function similarAvailable(): boolean;
export declare function findSimilar(cardId: string, limit?: number): Promise<SimilarHit[]>;
