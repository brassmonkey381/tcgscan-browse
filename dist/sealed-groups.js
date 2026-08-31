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
export const SEALED_GROUPS = [
    { key: 'packs', label: 'Packs' },
    { key: 'boxes', label: 'Booster Boxes' },
    { key: 'etb', label: 'Elite Trainer Boxes' },
    { key: 'bundles', label: 'Bundles' },
    { key: 'tins', label: 'Tins' },
    { key: 'decks', label: 'Decks' },
    { key: 'collections', label: 'Collections' },
    { key: 'other', label: 'Other' },
];
/** First match wins — specific before generic. */
const RULES = [
    [/elite trainer box|(^|\W)etb(\W|$)/i, 'etb'],
    [/booster (box|display|case)|display box/i, 'boxes'],
    [/booster bundle|(^|\W)bundle(\W|$)/i, 'bundles'],
    [/booster pack|sleeved booster|blister|checklane|(^|\W)promo pack/i, 'packs'],
    [/(^|\W)tin(s)?(\W|$)|poke ?ball tin|ball tin/i, 'tins'],
    [/theme deck|battle deck|league (battle )?deck|starter (deck|set)|v battle|deck box set|(^|\W)deck(\W|$)/i, 'decks'],
    [/premium collection|special collection|ultra.?premium|box set|collection box|gift set|(^|\W)collection(\W|$)|figure/i, 'collections'],
    // A bare "booster" that named neither pack nor box is almost always a single booster.
    [/(^|\W)booster(\W|$)/i, 'packs'],
    [/(^|\W)box(\W|$)/i, 'boxes'],
];
export function sealedGroupOf(name) {
    for (const [re, group] of RULES)
        if (re.test(name))
            return group;
    return 'other';
}
