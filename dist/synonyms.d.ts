/** One group: what the picker calls it, and the exact tag values that make it up. */
export interface ThemeSynonymGroup {
    label: string;
    /** Exact tag values (lowercase), in the order the host wants them listed. */
    members: readonly string[];
}
/** Persistence for the switch (device storage in michi). Omit and it is session-only. */
export interface SimilarWordsStore {
    load?: () => boolean | null | undefined | Promise<boolean | null | undefined>;
    save?: (on: boolean) => void;
}
/** How a `theme_any` field asks to be ordered. */
export type SimilarRank = 'lift' | 'plain';
export interface ThemeSynonymConfig {
    /** Groups per game id ('pokemon', 'lorcana', ...). A game without an entry never expands. */
    groupsByGame: Readonly<Record<string, readonly ThemeSynonymGroup[]>>;
    store?: SimilarWordsStore;
    /** Default 'lift'. */
    rank?: SimilarRank;
    /** Server cap on members per field (the contract says 48). */
    maxMembers?: number;
}
/** A wire field: plain fields carry a string, `theme_any` carries its members. */
export type WireField = {
    key: string;
    value: string;
} | {
    key: 'theme_any';
    value: string[];
    group: string;
    rank: SimilarRank;
};
/** What one typed word became, for the "Also searching" line. */
export interface SimilarExpansion {
    word: string;
    group: string;
    /** Every member except the typed word itself. */
    also: string[];
}
/** Hand the kit its groups (and optionally a store for the switch). Call once at startup. */
export declare function configureThemeSynonyms(next: ThemeSynonymConfig | null): void;
/** True when the host gave this game any groups: the switch is only shown then. */
export declare function hasThemeSynonyms(game?: string): boolean;
/**
 * The word forms tried for a lookup, most literal first: as typed, then a plural or -ing/-ed
 * folded off. The groups list most forms already (the data pipeline folds inflections); this only
 * catches a form the tags never used.
 */
export declare function wordForms(word: string): string[];
/** The group a word belongs to, or null. Matches a member or the group's own label. */
export declare function synonymGroupFor(word: string, game?: string): ThemeSynonymGroup | null;
/**
 * Rewrite a query's fields for the server. Off, or for a game with no groups: the fields as they
 * were. On: each bare, positive theme word in a group becomes one `theme_any` field. Namespaced
 * values (`scene:snow`), negations and words in no group pass through untouched.
 */
export declare function expandThemeFields(fields: readonly {
    key: string;
    value: string;
}[], { on, game }: {
    on: boolean;
    game?: string;
}): {
    fields: WireField[];
    expanded: SimilarExpansion[];
};
/** The current switch. Safe outside React (the search clients read it this way). */
export declare function getSimilarWords(): boolean;
/** Flip the switch; persisted through the configured store unless `{ persist: false }`. */
export declare function setSimilarWords(next: boolean, opts?: {
    persist?: boolean;
}): void;
/** Subscribe to switch (and group) changes outside React. Returns an unsubscribe. */
export declare function subscribeSimilarWords(callback: () => void): () => void;
/** The switch as a hook, shared by every surface. Loads the stored value on first use. */
export declare function useSimilarWords(): [boolean, (v: boolean) => void];
/** Test hook: back to a fresh module state. */
export declare function __resetSimilarWordsForTests(): void;
