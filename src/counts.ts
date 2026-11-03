/**
 * ONE WAY TO WRITE A COUNT (tcgscan-app's counts pick, 2026-11-02), the twin of the app's
 * lib/format count(): thousands grouped ('4,123'), the noun singular only at 1, irregular plurals
 * from one word table, and a non-breaking space so a figure never wraps away from its noun.
 */
const countFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const PLURALS: Record<string, string> = {
  copy: 'copies',
  match: 'matches',
  box: 'boxes',
  series: 'series',
};

export function plural(noun: string): string {
  if (PLURALS[noun]) return PLURALS[noun];
  const last = noun.split(' ').pop() ?? noun;
  if (PLURALS[last]) return noun.slice(0, noun.length - last.length) + PLURALS[last];
  if (/(s|x|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** count(4123) '4,123'; count(1, 'card') '1 card'; count(3, 'match') '3 matches'. */
export function count(n: number, noun?: string): string {
  if (!Number.isFinite(n)) return noun ? `unlimited ${plural(noun)}` : 'unlimited';
  const s = countFmt.format(n);
  if (!noun) return s;
  return `${s} ${n === 1 ? noun : plural(noun)}`;
}
