/**
 * The major kinds of sealed product, read off the product's name.
 *
 * The catalog carries no category field — the name is the taxonomy, and TCGPlayer's naming is
 * conventional enough ("Booster Box", "Elite Trainer Box", "Booster Bundle", "Tin") that keyword
 * rules cover nearly everything. The groups are the ones collectors actually shop by:
 *
 *   packs    single boosters: sleeved boosters, blister packs, promo packs
 *   boxes    booster boxes and displays — the sealed unit of account, and cases thereof
 *   etb      Elite Trainer Boxes, named apart from other boxes because the market prices them apart
 *   bundles  booster bundles (the 6-pack retail unit that replaced... nothing, it is its own thing)
 *   tins     tins, Poké Ball / Ultra Ball vessels included
 *   decks    preconstructed play products: theme/battle/league decks, V battle boxes
 *   collections  the named box sets: Premium / Special / Ultra-Premium Collections, gift sets
 *   other    everything the rules cannot place, honest rather than guessed
 *
 * ORDER MATTERS: rules run top to bottom and the FIRST match wins, so the specific outranks the
 * generic — an "Elite Trainer Box" never falls through to boxes on the word "Box", a "Booster
 * Bundle" never lands in packs on the word "Booster".
 *
 * IT LIVES BESIDE sealed.ts because it reads a field of the SHARED artifact: the grouping is a
 * property of the sealed data, not of one app's screen. Pure and dependency-free, and its
 * precedence is pinned by tcgscan-app/scripts/sealed-groups.test.ts — the kit has no test runner
 * of its own (package.json is build + check), and the app's harness resolves the kit's published
 * `src` directly, so the assertions double as a pin-bump regression check.
 */
/**
 * Each group twice: the full `label` for anywhere with room, and a `short` for a chip row.
 *
 * The chips are a filter bar on a phone, and "Elite Trainer Boxes" spent 180px saying what "ETB"
 * says to anyone who would be filtering by it — three of the nine groups fit on screen at once,
 * so the taxonomy was there without being browsable. The short forms are the ones the market
 * already uses, and they only differ where the long name was the problem.
 */
export declare const SEALED_GROUPS: readonly [{
    readonly key: "packs";
    readonly label: "Packs";
    readonly short: "Packs";
}, {
    readonly key: "boxes";
    readonly label: "Booster Boxes";
    readonly short: "Boxes";
}, {
    readonly key: "etb";
    readonly label: "Elite Trainer Boxes";
    readonly short: "ETB";
}, {
    readonly key: "bundles";
    readonly label: "Bundles";
    readonly short: "Bundles";
}, {
    readonly key: "tins";
    readonly label: "Tins";
    readonly short: "Tins";
}, {
    readonly key: "decks";
    readonly label: "Decks";
    readonly short: "Decks";
}, {
    readonly key: "collections";
    readonly label: "Collections";
    readonly short: "Collections";
}, {
    readonly key: "other";
    readonly label: "Other";
    readonly short: "Other";
}];
export type SealedGroup = (typeof SEALED_GROUPS)[number]['key'];
export declare function sealedGroupOf(name: string): SealedGroup;
