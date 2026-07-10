/**
 * Search-box query grammar for the card browser — one box for almost everything.
 *
 *     charizard artist:arita rarity:"holo rare" set:base series:base type:fire
 *     stage:basic year:1999 num:4 hp>200 stage>1 date>2023 >$100 <$500 sort:value
 *
 *  - bare words        AND-ed, case-insensitive substring match on the card name
 *  - key:value         field filters (quote multi-word values); substring match
 *  - key OP value      numeric/date comparisons — hp>200, stage>1, date>=06-2024
 *  - >$N / <$N         price bounds (also >=$N / <=$N, and value>N without the $)
 *  - sort:field[:dir]  result ordering (default: name relevance); dir = asc | desc
 *
 * EXTRACTION-READY (shared-browse): pure functions, no app imports — the card
 * shape and the price lookup are injected. This module is the seam that will
 * move to the shared tcgscan-browse package consumed by both michi-maker and
 * tcgscan-app, so keep it dependency-free.
 */
const FIELD_ALIASES = {
    artist: 'artist',
    illustrator: 'artist',
    rarity: 'rarity',
    set: 'set',
    series: 'series',
    type: 'type',
    types: 'type',
    stage: 'stage',
    year: 'year',
    num: 'num',
    number: 'num',
};
/** Sort field aliases → (canonical field, implied direction when the alias carries one). */
const SORT_ALIASES = {
    value: { field: 'value' },
    price: { field: 'value' },
    worth: { field: 'value' },
    name: { field: 'name' },
    alpha: { field: 'name' },
    date: { field: 'date' },
    released: { field: 'date' },
    release: { field: 'date' },
    newest: { field: 'date', dir: 'desc' },
    new: { field: 'date', dir: 'desc' },
    oldest: { field: 'date', dir: 'asc' },
    old: { field: 'date', dir: 'asc' },
    hp: { field: 'hp' },
    stage: { field: 'stage' },
    evo: { field: 'stage' },
    evolution: { field: 'stage' },
    relevance: { field: 'relevance' },
    rel: { field: 'relevance' },
    best: { field: 'relevance' },
};
/** Natural direction for each sort field when none is given (priciest/newest/highest first). */
const SORT_DEFAULT_DIR = {
    relevance: 'desc',
    value: 'desc',
    date: 'desc',
    name: 'asc',
    hp: 'desc',
    stage: 'asc',
};
/** Keys that address the release date via a comparison (`date>2023`, `year>=2010`). */
const DATE_COMPARE_KEYS = new Set(['date', 'release_date', 'releasedate', 'released', 'year']);
/**
 * Normalize a (possibly partial) date to a comparable yyyy[-mm[-dd]] prefix, so a lexical
 * string compare against a card's yyyy-mm-dd release date behaves like a real date compare:
 *   2023            -> "2023"        (year)
 *   06-2024 / 6/2024 -> "2024-06"    (month-year, month first)
 *   2024-06         -> "2024-06"     (year-month)
 *   2024-06-15      -> "2024-06-15"  (full date)
 * Returns null for anything unparseable (caller then treats the token as a plain word).
 */
function normalizeDatePrefix(v) {
    const s = v.trim();
    let m;
    if ((m = s.match(/^(\d{4})$/)))
        return m[1];
    if ((m = s.match(/^(\d{1,2})[-/](\d{4})$/)))
        return `${m[2]}-${m[1].padStart(2, '0')}`;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/)))
        return `${m[1]}-${m[2].padStart(2, '0')}`;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)))
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return null;
}
/** Resolve a `sort:` value (which may carry a `:dir` suffix) to a field + direction. */
function parseSort(rawValue) {
    const [fieldTok, dirTok] = rawValue.toLowerCase().split(':', 2);
    const alias = SORT_ALIASES[fieldTok];
    if (!alias)
        return null;
    let dir = alias.dir ?? SORT_DEFAULT_DIR[alias.field];
    if (dirTok === 'asc' || dirTok === 'ascending' || dirTok === 'up')
        dir = 'asc';
    else if (dirTok === 'desc' || dirTok === 'descending' || dirTok === 'down')
        dir = 'desc';
    return { sort: alias.field, dir };
}
/** `rarity:"holo rare"` / `artist:arita` / `hp>200` / `>$100` / bare words — quote-aware. */
export function parseQuery(raw) {
    const out = {
        words: [],
        fields: [],
        comparisons: [],
        minPrice: null,
        maxPrice: null,
        sort: 'relevance',
        sortDir: 'desc',
        hasStructure: false,
    };
    // Tokenize: key:"quoted value" | key:value | "quoted words" | word | >$n | key>n
    const tokens = raw.match(/[a-zA-Z]+:"[^"]*"|[a-zA-Z_]+[<>]=?[^\s"]+|[a-zA-Z]+:[^\s"]+|"[^"]*"|[^\s"]+/g) ?? [];
    for (const token of tokens) {
        // Bare price bound: >$100, <=$5 (the $ is optional so >100 works too).
        const price = token.match(/^(>=|<=|>|<)\$?(\d+(?:\.\d+)?)$/);
        if (price) {
            const n = parseFloat(price[2]);
            if (price[1].startsWith('>'))
                out.minPrice = n;
            else
                out.maxPrice = n;
            out.hasStructure = true;
            continue;
        }
        // Keyed comparison: hp>200, stage>1, date>=06-2024, value>100.
        const comp = token.match(/^([a-zA-Z_]+)(>=|<=|>|<)(.+)$/);
        if (comp && addComparison(out, comp[1].toLowerCase(), comp[2], comp[3])) {
            out.hasStructure = true;
            continue;
        }
        const kv = token.match(/^([a-zA-Z]+):(.+)$/);
        if (kv) {
            const rawKey = kv[1].toLowerCase();
            const value = kv[2].replace(/^"|"$/g, '').toLowerCase().trim();
            if (rawKey === 'sort') {
                const s = parseSort(value);
                if (s) {
                    out.sort = s.sort;
                    out.sortDir = s.dir;
                }
                out.hasStructure = true;
                continue;
            }
            // Colon form of a numeric/date field means "equals": hp:120, date:2023.
            if (value && addComparison(out, rawKey, '=', value)) {
                out.hasStructure = true;
                continue;
            }
            const key = FIELD_ALIASES[rawKey];
            if (key && value) {
                out.fields.push({ key, value });
                out.hasStructure = true;
                continue;
            }
            // Unknown key — treat the whole token as a name word so typos still search.
        }
        const word = token.replace(/^"|"$/g, '').toLowerCase().trim();
        if (word)
            out.words.push(word);
    }
    return out;
}
/**
 * Try to record `key OP value` as a comparison filter. Returns true when the key names a
 * numeric/date field AND the value parses; false otherwise (caller falls back to a word).
 */
function addComparison(out, key, op, rawValue) {
    const value = rawValue.replace(/^"|"$/g, '').trim();
    if (key === 'hp') {
        if (!/^\d+(?:\.\d+)?$/.test(value))
            return false;
        out.comparisons.push({ field: 'hp', op, value });
        return true;
    }
    if (key === 'stage') {
        if (!/^-?\d+$/.test(value))
            return false; // stage:basic stays a string field, not this
        out.comparisons.push({ field: 'stage', op, value });
        return true;
    }
    if (key === 'value' || key === 'price' || key === 'worth') {
        const n = parseFloat(value);
        if (!isFinite(n))
            return false;
        if (op === '>' || op === '>=')
            out.minPrice = n;
        else if (op === '<' || op === '<=')
            out.maxPrice = n;
        else {
            out.minPrice = n;
            out.maxPrice = n;
        }
        return true;
    }
    if (DATE_COMPARE_KEYS.has(key)) {
        const prefix = normalizeDatePrefix(value);
        if (!prefix)
            return false;
        out.comparisons.push({ field: 'date', op, value: prefix });
        return true;
    }
    return false;
}
function fieldValues(card, key) {
    switch (key) {
        case 'artist':
        case 'illustrator':
            return card.illustrator ? [card.illustrator] : [];
        case 'rarity':
            return card.rarity ? [card.rarity] : [];
        case 'set':
            return card.setName ? [card.setName] : [];
        case 'series':
            return card.seriesId ? [card.seriesId] : [];
        case 'type':
            // both the TCG energy type (Fire) and the card type (Pokemon/Trainer/…)
            return [...card.types, ...card.cardType];
        case 'stage':
            return card.stage ? [card.stage] : [];
        case 'year':
            return card.releaseDate ? [card.releaseDate.slice(0, 4)] : [];
        case 'num':
            return card.number ? [card.number] : [];
    }
}
function numCompare(a, op, b) {
    switch (op) {
        case '>':
            return a > b;
        case '>=':
            return a >= b;
        case '<':
            return a < b;
        case '<=':
            return a <= b;
        case '=':
            return a === b;
    }
}
/** Does the card satisfy one numeric/date comparison? Unknown values never match (excluded). */
function matchComparison(card, c) {
    if (c.field === 'hp') {
        if (card.hp == null)
            return false;
        return numCompare(card.hp, c.op, parseFloat(c.value));
    }
    if (c.field === 'stage') {
        if (card.evolutionStage < 0)
            return false;
        return numCompare(card.evolutionStage, c.op, parseFloat(c.value));
    }
    // date — lexical compare against the normalized prefix (see normalizeDatePrefix). `>`/`>=`
    // both mean "in or after that period" (so date>2023 includes all of 2023), matching intent.
    const d = card.releaseDate;
    if (!d)
        return false;
    const p = c.value;
    switch (c.op) {
        case '=':
            return d.startsWith(p);
        case '>':
        case '>=':
            return d >= p;
        case '<':
            return d < p;
        case '<=':
            return d <= p + '￿'; // any date within the period sorts before this sentinel
    }
}
/** Per-card lowercased search text, cached (cards are stable objects). */
const loweredCache = new WeakMap();
function lowered(card) {
    let entry = loweredCache.get(card);
    if (!entry) {
        entry = {
            name: card.name.toLowerCase(),
            rest: [
                card.illustrator,
                card.setName,
                card.seriesId,
                card.rarity,
                card.stage,
                card.number,
                ...card.types,
                ...card.cardType,
            ]
                .filter(Boolean)
                .map((v) => v.toLowerCase()),
        };
        loweredCache.set(card, entry);
    }
    return entry;
}
/**
 * Relevance score for `card` against the query — 0 rejects, higher ranks earlier.
 * Bare words match ANY field ("arita" finds the illustrator, "sword" finds
 * Sword & Shield cards), every word must land somewhere (AND), and name hits
 * outrank other-field hits so "charizard" still puts Charizards first.
 */
export function scoreCard(card, q, priceOf) {
    const { name, rest } = lowered(card);
    let score = 1;
    for (const w of q.words) {
        if (name.includes(w)) {
            score += name.startsWith(w) ? 5 : 3;
        }
        else if (rest.some((v) => v.includes(w))) {
            score += 1;
        }
        else {
            return 0; // every bare word must match somewhere
        }
    }
    for (const { key, value } of q.fields) {
        if (!fieldValues(card, key).some((v) => v.toLowerCase().includes(value)))
            return 0;
    }
    for (const c of q.comparisons) {
        if (!matchComparison(card, c))
            return 0;
    }
    if (q.minPrice !== null || q.maxPrice !== null) {
        const price = priceOf(card.id);
        if (q.minPrice !== null && price < q.minPrice)
            return 0;
        if (q.maxPrice !== null && price > q.maxPrice)
            return 0;
    }
    return score;
}
/** Does `card` satisfy the query? (scoreCard > 0.) */
export function matchCard(card, q, priceOf) {
    return scoreCard(card, q, priceOf) > 0;
}
/**
 * The one-call search: filter + rank + cap. Relevance = score desc (stable
 * within ties); explicit sort:value/newest/name overrides.
 */
export function runQuery(cards, q, priceOf, limit = 200) {
    const scored = [];
    for (const card of cards) {
        const s = scoreCard(card, q, priceOf);
        if (s > 0)
            scored.push({ card, score: s });
    }
    if (q.sort === 'relevance') {
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, limit).map((s) => s.card);
    }
    return sortCards(scored.map((s) => s.card), q, priceOf).slice(0, limit);
}
/**
 * Stable sort by a nullable key, with unknown (null) keys always sunk to the bottom
 * regardless of direction — so `sort:hp` and `sort:hp:asc` both leave HP-less cards last.
 */
function sortByKey(cards, keyOf, dir, compare) {
    const known = [];
    const unknown = [];
    for (const c of cards)
        (keyOf(c) == null ? unknown : known).push(c);
    const mul = dir === 'asc' ? 1 : -1;
    known.sort((a, b) => mul * compare(keyOf(a), keyOf(b)));
    return [...known, ...unknown];
}
/** Order results per the query's sort field + direction (relevance = input order). */
export function sortCards(cards, q, priceOf) {
    const mul = q.sortDir === 'asc' ? 1 : -1;
    switch (q.sort) {
        case 'value':
            return [...cards].sort((a, b) => mul * (priceOf(a.id) - priceOf(b.id)));
        case 'name':
            return [...cards].sort((a, b) => mul * a.name.localeCompare(b.name));
        case 'date':
            return sortByKey(cards, (c) => c.releaseDate || null, q.sortDir, (a, b) => String(a).localeCompare(String(b)));
        case 'hp':
            return sortByKey(cards, (c) => c.hp, q.sortDir, (a, b) => a - b);
        case 'stage':
            return sortByKey(cards, (c) => (c.evolutionStage >= 0 ? c.evolutionStage : null), q.sortDir, (a, b) => a - b);
        default:
            return cards; // relevance
    }
}
/** Display fields a bare word is attributed to, in tally order (name first). */
const WORD_FIELDS = [
    { label: 'name', values: (c) => [c.name] },
    { label: 'artist', values: (c) => (c.illustrator ? [c.illustrator] : []) },
    { label: 'set', values: (c) => (c.setName ? [c.setName] : []) },
    { label: 'series', values: (c) => (c.seriesId ? [c.seriesId] : []) },
    { label: 'rarity', values: (c) => (c.rarity ? [c.rarity] : []) },
    { label: 'type', values: (c) => [...c.types, ...c.cardType] },
    { label: 'stage', values: (c) => (c.stage ? [c.stage] : []) },
    { label: 'num', values: (c) => (c.number ? [c.number] : []) },
];
/** `holo rare` -> `"holo rare"`; single words stay bare. */
function quoteIfSpaced(v) {
    return v.includes(' ') ? `"${v}"` : v;
}
const usd = (n) => `$${n.toFixed(2)}`;
/**
 * Terse echo of how the query was UNDERSTOOD — shown under the search box.
 * Bare words are attributed to the field they predominantly matched across the
 * results (pass `matched`), so "arita fire >0 <100" echoes as
 *     artist=arita & type=fire & ($0.00 ≤ value ≤ $100.00)
 * A word with mixed/unknowable attribution stays as "word".
 */
export function describeQuery(q, matched = []) {
    const parts = [];
    const sample = matched.slice(0, 200);
    for (const w of q.words) {
        let label = '';
        if (sample.length > 0) {
            let best = 0;
            for (const f of WORD_FIELDS) {
                const n = sample.filter((c) => f.values(c).some((v) => v.toLowerCase().includes(w))).length;
                if (n > best) {
                    best = n;
                    label = f.label;
                }
            }
            // Only attribute when the field explains (nearly) every result.
            if (best < sample.length * 0.9)
                label = '';
        }
        parts.push(label && label !== 'name' ? `${label}=${quoteIfSpaced(w)}` : `"${w}"`);
    }
    for (const f of q.fields)
        parts.push(`${f.key}=${quoteIfSpaced(f.value)}`);
    for (const c of q.comparisons)
        parts.push(`${c.field}${c.op}${c.value}`);
    if (q.minPrice !== null && q.maxPrice !== null) {
        parts.push(`(${usd(q.minPrice)} ≤ value ≤ ${usd(q.maxPrice)})`);
    }
    else if (q.minPrice !== null) {
        parts.push(`(value ≥ ${usd(q.minPrice)})`);
    }
    else if (q.maxPrice !== null) {
        parts.push(`(value ≤ ${usd(q.maxPrice)})`);
    }
    if (q.sort !== 'relevance')
        parts.push(`sort=${q.sort}${q.sortDir === 'asc' ? '↑' : '↓'}`);
    return parts.join(' & ');
}
/** Placeholder/help line advertising the grammar (shared by both apps' search boxes). */
export const QUERY_HINT = 'try: charizard hp>200 date>2023 sort:value';
export const QUERY_MANUAL = [
    {
        title: 'Just type words',
        rows: [
            ['charizard', 'matches names first, then artist, set, series, rarity, type, stage, number'],
            ['arita fire', 'every word must match somewhere — combine freely'],
        ],
    },
    {
        title: 'Target a field',
        rows: [
            ['artist:arita', 'illustrator (alias: illustrator:)'],
            ['rarity:"holo rare"', 'rarity — quote multi-word values'],
            ['set:base', 'set name'],
            ['series:sword', 'series name'],
            ['type:fire', 'energy type or card type (Pokemon / Trainer / …)'],
            ['stage:basic', 'evolution stage by name (Basic, Stage1, VMAX, …)'],
            ['num:4', 'collector number (alias: number:)'],
        ],
    },
    {
        title: 'Compare numbers & dates',
        rows: [
            ['>$100', 'value at least $100 (also <$5, >=, <=, or value>100)'],
            ['hp>200', 'printed HP — also hp<=60, hp:120 (exactly)'],
            ['stage>1', 'evolved forms (Basic = 1, Stage 1 = 2, …); stage:basic matches by name'],
            ['date>2023', 'released in 2023 or later (release_date: works too)'],
            ['date>=06-2024', 'partial dates ok: 2023, 06-2024, or 2024-06-15'],
            ['year:1999', 'exact release year'],
        ],
    },
    {
        title: 'Sort',
        rows: [
            ['sort:value', 'priciest first (tiles show values) — add :asc for cheapest'],
            ['sort:newest', 'newest release first (sort:oldest for oldest)'],
            ['sort:hp', 'highest HP first'],
            ['sort:stage', 'Basic → most evolved'],
            ['sort:name', 'alphabetical (sort:name:desc for Z→A)'],
            ['…:asc / …:desc', 'add to any sort to flip its direction'],
        ],
    },
    {
        title: 'More',
        rows: [
            ['grey line', 'shows how your search was understood — tweak from there'],
            ['≈ similar', 'select a card, then tap ≈ similar for visual look-alikes'],
            ['View <artist>', "tap a card → View <artist> to see all of that illustrator's cards"],
            ['Filters', 'the chip filters combine with any search'],
        ],
    },
];
