/**
 * Search-box query grammar for the card browser — one box for almost everything.
 *
 *     charizard artist:arita rarity:"holo rare" set:base series:base type:fire
 *     stage:basic year:1999 num:4 >$100 <$500 sort:value
 *
 *  - bare words        AND-ed, case-insensitive substring match on the card name
 *  - key:value         field filters (quote multi-word values); substring match
 *  - >$N / <$N         price bounds (also >=$N / <=$N)
 *  - sort:value|newest|name   result ordering (default: name relevance)
 *
 * EXTRACTION-READY (shared-browse): pure functions, no app imports — the card
 * shape and the price lookup are injected. This module is the seam that will
 * move to the shared tcgscan-browse package consumed by both michi-maker and
 * tcgscan-app, so keep it dependency-free.
 */

/** The card fields the grammar can address. Both apps' catalog cards satisfy this. */
export interface QueryableCard {
  id: string;
  name: string;
  number: string;
  rarity: string;
  cardType: string[];
  setName: string;
  seriesId: string;
  releaseDate: string;
  illustrator: string;
  types: string[];
  stage: string;
}

export type QuerySort = 'relevance' | 'value' | 'newest' | 'name';

export interface ParsedQuery {
  /** Bare words — every one must appear in the card name. */
  words: string[];
  /** key -> value filters (already lowercased). */
  fields: { key: FieldKey; value: string }[];
  minPrice: number | null;
  maxPrice: number | null;
  sort: QuerySort;
  /** True when anything beyond bare name words is present. */
  hasStructure: boolean;
}

export type FieldKey =
  | 'artist'
  | 'illustrator'
  | 'rarity'
  | 'set'
  | 'series'
  | 'type'
  | 'stage'
  | 'year'
  | 'num';

const FIELD_ALIASES: Record<string, FieldKey> = {
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

/** `rarity:"holo rare"` / `artist:arita` / `>$100` / bare words — quote-aware. */
export function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = {
    words: [],
    fields: [],
    minPrice: null,
    maxPrice: null,
    sort: 'relevance',
    hasStructure: false,
  };
  // Tokenize: key:"quoted value" | key:value | "quoted words" | word | >$n
  const tokens = raw.match(/[a-zA-Z]+:"[^"]*"|[a-zA-Z]+:[^\s"]+|"[^"]*"|[^\s"]+/g) ?? [];
  for (const token of tokens) {
    const price = token.match(/^(>=|<=|>|<)\$?(\d+(?:\.\d+)?)$/);
    if (price) {
      const n = parseFloat(price[2]);
      if (price[1].startsWith('>')) out.minPrice = n;
      else out.maxPrice = n;
      out.hasStructure = true;
      continue;
    }
    const kv = token.match(/^([a-zA-Z]+):(.+)$/);
    if (kv) {
      const key = FIELD_ALIASES[kv[1].toLowerCase()];
      const value = kv[2].replace(/^"|"$/g, '').toLowerCase().trim();
      if (kv[1].toLowerCase() === 'sort') {
        if (value === 'value' || value === 'price') out.sort = 'value';
        else if (value === 'newest' || value === 'new') out.sort = 'newest';
        else if (value === 'name') out.sort = 'name';
        out.hasStructure = true;
        continue;
      }
      if (key && value) {
        out.fields.push({ key, value });
        out.hasStructure = true;
        continue;
      }
      // Unknown key — treat the whole token as a name word so typos still search.
    }
    const word = token.replace(/^"|"$/g, '').toLowerCase().trim();
    if (word) out.words.push(word);
  }
  return out;
}

function fieldValues(card: QueryableCard, key: FieldKey): string[] {
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

/** Per-card lowercased search text, cached (cards are stable objects). */
const loweredCache = new WeakMap<QueryableCard, { name: string; rest: string[] }>();

function lowered(card: QueryableCard): { name: string; rest: string[] } {
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
export function scoreCard(
  card: QueryableCard,
  q: ParsedQuery,
  priceOf: (id: string) => number,
): number {
  const { name, rest } = lowered(card);
  let score = 1;
  for (const w of q.words) {
    if (name.includes(w)) {
      score += name.startsWith(w) ? 5 : 3;
    } else if (rest.some((v) => v.includes(w))) {
      score += 1;
    } else {
      return 0; // every bare word must match somewhere
    }
  }
  for (const { key, value } of q.fields) {
    if (!fieldValues(card, key).some((v) => v.toLowerCase().includes(value))) return 0;
  }
  if (q.minPrice !== null || q.maxPrice !== null) {
    const price = priceOf(card.id);
    if (q.minPrice !== null && price < q.minPrice) return 0;
    if (q.maxPrice !== null && price > q.maxPrice) return 0;
  }
  return score;
}

/** Does `card` satisfy the query? (scoreCard > 0.) */
export function matchCard(
  card: QueryableCard,
  q: ParsedQuery,
  priceOf: (id: string) => number,
): boolean {
  return scoreCard(card, q, priceOf) > 0;
}

/**
 * The one-call search: filter + rank + cap. Relevance = score desc (stable
 * within ties); explicit sort:value/newest/name overrides.
 */
export function runQuery<T extends QueryableCard>(
  cards: T[],
  q: ParsedQuery,
  priceOf: (id: string) => number,
  limit = 200,
): T[] {
  const scored: { card: T; score: number }[] = [];
  for (const card of cards) {
    const s = scoreCard(card, q, priceOf);
    if (s > 0) scored.push({ card, score: s });
  }
  if (q.sort === 'relevance') {
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.card);
  }
  return sortCards(
    scored.map((s) => s.card),
    q,
    priceOf,
  ).slice(0, limit);
}

/** Order results per the query's sort (stable for equal keys; relevance = input order). */
export function sortCards<T extends QueryableCard>(
  cards: T[],
  q: ParsedQuery,
  priceOf: (id: string) => number,
): T[] {
  if (q.sort === 'value') {
    return [...cards].sort((a, b) => priceOf(b.id) - priceOf(a.id));
  }
  if (q.sort === 'newest') {
    return [...cards].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  }
  if (q.sort === 'name') {
    return [...cards].sort((a, b) => a.name.localeCompare(b.name));
  }
  return cards;
}

/** Display fields a bare word is attributed to, in tally order (name first). */
const WORD_FIELDS: { label: string; values: (c: QueryableCard) => string[] }[] = [
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
function quoteIfSpaced(v: string): string {
  return v.includes(' ') ? `"${v}"` : v;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Terse echo of how the query was UNDERSTOOD — shown under the search box.
 * Bare words are attributed to the field they predominantly matched across the
 * results (pass `matched`), so "arita fire >0 <100" echoes as
 *     artist=arita & type=fire & ($0.00 ≤ value ≤ $100.00)
 * A word with mixed/unknowable attribution stays as "word".
 */
export function describeQuery(q: ParsedQuery, matched: QueryableCard[] = []): string {
  const parts: string[] = [];
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
      if (best < sample.length * 0.9) label = '';
    }
    parts.push(label && label !== 'name' ? `${label}=${quoteIfSpaced(w)}` : `"${w}"`);
  }
  for (const f of q.fields) parts.push(`${f.key}=${quoteIfSpaced(f.value)}`);
  if (q.minPrice !== null && q.maxPrice !== null) {
    parts.push(`(${usd(q.minPrice)} ≤ value ≤ ${usd(q.maxPrice)})`);
  } else if (q.minPrice !== null) {
    parts.push(`(value ≥ ${usd(q.minPrice)})`);
  } else if (q.maxPrice !== null) {
    parts.push(`(value ≤ ${usd(q.maxPrice)})`);
  }
  if (q.sort !== 'relevance') parts.push(`sort=${q.sort}`);
  return parts.join(' & ');
}

/** Placeholder/help line advertising the grammar (shared by both apps' search boxes). */
export const QUERY_HINT = 'try: arita rarity:holo type:fire >$100 sort:value';

/**
 * The search user manual — data, not UI, so every app renders the same manual
 * in its own components (the "?" help panel).
 */
export interface ManualSection {
  title: string;
  rows: [code: string, description: string][];
}

export const QUERY_MANUAL: ManualSection[] = [
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
      ['stage:basic', 'evolution stage (Basic, Stage1, VMAX, …)'],
      ['year:1999', 'release year'],
      ['num:4', 'collector number (alias: number:)'],
    ],
  },
  {
    title: 'Filter by value',
    rows: [
      ['>$100', 'worth at least $100 (also >=)'],
      ['<$5', 'worth at most $5 (also <=)'],
      ['>0 <100', 'combine for a range'],
    ],
  },
  {
    title: 'Sort',
    rows: [
      ['sort:value', 'priciest first (tiles show values)'],
      ['sort:newest', 'newest release first'],
      ['sort:name', 'alphabetical'],
    ],
  },
  {
    title: 'More',
    rows: [
      ['grey line', 'shows how your search was understood — tweak from there'],
      ['≈ similar', 'select a card, then tap ≈ similar for visual look-alikes'],
      ['Filters', 'the chip filters combine with any search'],
    ],
  },
];
