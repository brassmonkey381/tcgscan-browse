// Verifies theme search against dist/ with a stubbed fetch: a secondary game's (themeServer, v0.9.28)
// and Pokemon's toolbar (themeTools, v0.9.29).
// Run: npm run build && node scripts/theme-server-check.mjs. Nothing here reaches a network.
//
// (a) searchThemes' body, direct and on the paid proxy path (`rpc: 'theme_search'`)
// (b) Pokemon searchCards bodies are byte-identical to v0.9.27's (golden strings below)
// (c) filterCards keeps input order and drops theme-only misses
// (d) the clamped / degraded / failed flags
// (e) mergeThemeHits drops ids the catalog lacks (and groups by registry order when asked)
// (f) a 2-page total under sort:value fetches both pages before anything renders (CP-3); a paid
//     drain whose proxy breaks mid-result stops at once instead of re-asking the free top N
// (g) a clamped page with grouping on is stable-sorted by typeGroups order (CP-2)
// (h) the failure view's Retry calls rpc/theme_search, never rpc/search_cards (CP-6)
// (i) Pokemon's toolbar (themeTools, K5): p_fields order; bodies byte-identical when it is off or at
//     its defaults; search_facets counts; a clamped page grouped by registry order on the device;
//     the server's type_group wins over the local label; warm themed results page past 90; a
//     pokemon: namespace query routes to search_cards (the parser's verdict, not a regex)
//
// (f)-(h) render the real CatalogBrowser with React 19 + react-test-renderer (a devDependency);
// react-native, expo-image and react-native-svg are stubbed as plain host components. The loader is
// registered inline, so this one file is the whole harness.
import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const reactUrl = pathToFileURL(require.resolve('react')).href;
const STUBS = {
  'react-native': `import React from '${reactUrl}';
const host = (name) => { const C = (p) => React.createElement(name, p); C.displayName = name; return C; };
export const View = host('View'), Text = host('Text'), Pressable = host('Pressable'), ScrollView = host('ScrollView'),
  TextInput = host('TextInput'), Modal = host('Modal'), FlatList = host('FlatList'), ActivityIndicator = host('ActivityIndicator'),
  TouchableOpacity = host('TouchableOpacity'), Switch = host('Switch'), SectionList = host('SectionList');
export const Platform = { OS: 'ios', select: (o) => o.ios ?? o.default };
export const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1 };
export const AccessibilityInfo = { isReduceMotionEnabled: () => Promise.resolve(true) };
class Value { constructor(v) { this.v = v; } interpolate() { return this; } setValue(v) { this.v = v; } }
const anim = () => ({ start() {}, stop() {} });
export const Animated = { Value, View: host('Animated.View'), timing: anim, sequence: anim, loop: anim, delay: anim };
export const Dimensions = { get: () => ({ width: 800, height: 600 }) };
export const useWindowDimensions = () => ({ width: 800, height: 600 });
export const PixelRatio = { get: () => 2 };
export const Linking = { openURL: () => Promise.resolve() };
export const Keyboard = { dismiss() {} };
export default {};`,
  'expo-image': `import React from '${reactUrl}';
export const Image = (p) => React.createElement('Image', p);
Image.prefetch = () => Promise.resolve(true);
export default {};`,
  'react-native-svg': `import React from '${reactUrl}';
const host = (n) => (p) => React.createElement(n, p);
export const Svg = host('Svg'), Path = host('Path'), Circle = host('Circle'), Rect = host('Rect'), G = host('G'),
  Defs = host('Defs'), LinearGradient = host('LinearGradient'), Stop = host('Stop'), Line = host('Line'),
  Polyline = host('Polyline'), Text = host('SvgText');
export default Svg;`,
};
const loader = `
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const STUBS = ${JSON.stringify(STUBS)};
export function resolve(spec, ctx, next) {
  if (STUBS[spec] !== undefined) return { url: 'stub:' + spec, shortCircuit: true };
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = new URL(spec, ctx.parentURL);
    const p = fileURLToPath(base);
    if (!/\\.[cm]?js$/.test(p) && existsSync(p + '.js')) return { url: base.href + '.js', shortCircuit: true };
  }
  return next(spec, ctx);
}
export function load(url, ctx, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(loader));

const root = new URL('../dist/', import.meta.url).href;
const load = (m) => import(root + m);
const { default: React } = await import(reactUrl);
const { default: TR } = await import(pathToFileURL(require.resolve('react-test-renderer')).href);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const origErr = console.error;
console.error = (...a) => {
  if (String(a[0]).includes('react-test-renderer is deprecated')) return;
  origErr(...a);
};

const config = await load('config.js');
const query = await load('query.js');
const search = await load('search.js');
const catalogM = await load('catalog.js');
const state = await load('state.js');
const { CatalogBrowser } = await load('CatalogBrowser.js');

// ---------------------------------------------------------------- the stub server
const API = 'https://x/rest/v1';
const PROXY = 'https://host/functions/v1/theme-search';
const G = ['Ruby', 'Amber', 'Steel'];
const env = { total: 650, depth: 0, fail: false, proxyStatus: 200, breakAfter: 0, defer: false, queue: [], log: [], poke: null };
const reply = (j, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => j,
  text: async () => JSON.stringify(j),
  headers: { get: () => null },
});
// As the RPC does: a metered (direct) call with a free depth gets the top `depth` rows, its offset
// pinned to 0; the proxy (paid) is never metered.
const themeRows = (body, paid = false) => {
  const metered = env.depth > 0 && !paid;
  const off = metered ? 0 : body.p_offset;
  const n = Math.min(env.total, off + (metered ? Math.min(body.p_limit, env.depth) : body.p_limit));
  const rows = [];
  for (let i = off; i < n; i++)
    rows.push({ id: 'c' + i, art_band: i % 3, full_art: i % 2 === 0, type_group: G[i % 3], total_count: env.total });
  return rows;
};
// Pokemon search_cards rows (env.poke = { total, types, groups? }): ids c<i>, types[0] cycling through
// `types`; with `groups`, each row also carries a server type_group (a possible later migration;
// 81 does not return it). Metered the
// same way as theme_search above.
const PT = ['Water', 'Fire', 'Grass'];
const pokeRows = (body) => {
  const P = env.poke;
  const metered = env.depth > 0;
  const off = metered ? 0 : body.p_offset;
  const n = Math.min(P.total, off + (metered ? Math.min(body.p_limit, env.depth) : body.p_limit));
  const rows = [];
  for (let i = off; i < n; i++)
    rows.push({
      id: 'c' + i, name: 'Card ' + i, number: String(i), rarity: 'Common', card_type: ['Pokemon'], set_id: 1,
      set_name: 'Set One', series: 'Ser', release_date: '2024-01-01', illustrator: '', types: [PT[i % 3]],
      stage: 'Basic', hp: 60, evolution_stage_index: 0, evolves_from: null, evolution_line: [], jumbo: false,
      language: 'en', cur: 1, score: 1, total_count: P.total,
      ...(P.groups ? { type_group: P.groups[i % P.groups.length], full_art: i % 2 === 0, art_band: 2 } : {}),
    });
  return rows;
};
const answer = (url, body) => {
  if (env.poke && url.includes('/rpc/search_cards')) return reply(pokeRows(body));
  if (env.poke?.facets && url.includes('/rpc/search_facets')) return reply(env.poke.facets);
  if (url === PROXY) {
    if (env.proxyStatus !== 200) return reply({ error: 'x' }, env.proxyStatus);
    if (env.breakAfter && --env.breakAfter === 0) env.proxyStatus = 500; // answers this one, then breaks
    return reply(themeRows(body, true));
  }
  if (url.includes('/rpc/theme_search')) return env.fail ? reply({ message: 'boom' }, 500) : reply(themeRows(body));
  if (url.includes('/rpc/theme_facets'))
    return reply([
      { facet: 'frame', value: 'full', n: 10 },
      { facet: 'frame', value: 'window', n: 20 },
      { facet: 'type', value: 'Amber', n: 5 },
    ]);
  if (url.includes('search_config')) return reply([{ free_theme_depth: env.depth }]);
  if (url.includes('/rpc/')) return reply([]);
  return reply(null, 404);
};
globalThis.fetch = async (u, init) => {
  const url = String(u);
  const raw = init?.body ?? null;
  const body = raw ? JSON.parse(raw) : null;
  env.log.push({ url, raw, body });
  if (env.defer && url.includes('/rpc/theme_search')) return new Promise((res) => env.queue.push(() => res(answer(url, body))));
  return answer(url, body);
};
const calls = (rpc) => env.log.filter((l) => l.url.includes('/rpc/' + rpc));
const fresh = (over = {}) => {
  Object.assign(env, { total: 650, depth: 0, fail: false, proxyStatus: 200, breakAfter: 0, defer: false, queue: [], log: [], poke: null }, over);
  search._resetSearchCaches(); // the free depth is read once per process
  delete state.browseState.themeFrame;
  delete state.browseState.themeTypes;
  delete state.browseState.themeGroup;
};
const configure = (themedSearch) =>
  config.configureBrowse({ browseUrl: 'https://x/browse', imgBase: '', apiUrl: API, apiKey: 'k', themedSearch });
configure(undefined);

// ---------------------------------------------------------------- (a) searchThemes body
{
  fresh();
  const q = { themes: ['forest', '-night'], words: ['elsa'], frame: 'full', types: ['Amber'], group: true };
  const page = await search.searchThemes('lorcana', q, { limit: 300, offset: 0, languages: ['en'] });
  const ts = calls('theme_search');
  assert.equal(ts.length, 1, '(a) one direct call');
  assert.equal(
    ts[0].raw,
    '{"p_game":"lorcana","p_fields":[{"key":"theme","value":"forest"},{"key":"theme","value":"-night"}],' +
      '"p_words":["elsa"],"p_frame":"full","p_types":["Amber"],"p_group":true,"p_limit":300,"p_offset":0,"p_lang":["en"]}',
    '(a) direct body',
  );
  assert.equal(page.hits.length, 300);
  assert.deepEqual(page.hits[0], { id: 'c0', artBand: 0, fullArt: true, typeGroup: 'Ruby' }, '(a) hit shape');
  assert.equal(page.total, 650);

  // Defaults: all art and no chips send null, the limit is capped at the RPC's 1000, p_lang is omitted.
  fresh();
  await search.searchThemes('onepiece', { themes: ['forest'], words: [] }, { limit: 5000, offset: 1000 });
  assert.equal(
    calls('theme_search')[0].raw,
    '{"p_game":"onepiece","p_fields":[{"key":"theme","value":"forest"}],"p_words":[],"p_frame":null,' +
      '"p_types":null,"p_group":false,"p_limit":1000,"p_offset":1000}',
    '(a) defaults',
  );

  // Paid path: the proxy gets the same parameters tagged rpc:'theme_search', and getToken learns the game.
  fresh();
  const asked = [];
  configure({ url: PROXY, getToken: async (x) => (asked.push(x), 'tok') });
  const paid = await search.searchThemes('lorcana', { themes: ['forest'], words: [] }, { limit: 60 });
  const px = env.log.filter((l) => l.url === PROXY);
  assert.equal(px.length, 1, '(a) proxy called');
  assert.equal(
    px[0].raw,
    '{"rpc":"theme_search","p_game":"lorcana","p_fields":[{"key":"theme","value":"forest"}],"p_words":[],' +
      '"p_frame":null,"p_types":null,"p_group":false,"p_limit":60,"p_offset":0}',
    '(a) proxy body',
  );
  assert.deepEqual(asked, [{ themes: ['forest'], game: 'lorcana' }], '(a) getToken({ themes, game })');
  assert.equal(calls('theme_search').length, 0, '(a) a paid answer makes no direct call');
  assert.equal(paid.clamped, false, '(a) the paid path is never clamped');
  configure(undefined);

  // themeFacets: always direct, the shared parameters only, counts by facet.
  fresh();
  const counts = await search.themeFacets('lorcana', { themes: ['forest'], words: [], frame: 'window', types: ['Ruby'] });
  assert.equal(
    calls('theme_facets')[0].raw,
    '{"p_game":"lorcana","p_fields":[{"key":"theme","value":"forest"}],"p_words":[],"p_frame":"window","p_types":["Ruby"]}',
    '(a) facets body',
  );
  assert.deepEqual(counts, { frame: { full: 10, window: 20 }, type: { Amber: 5 } });
  console.log('(a) searchThemes / themeFacets bodies: ok');
}

// ---------------------------------------------------------------- (b) Pokemon searchCards golden bodies
{
  // Captured from the committed v0.9.27 dist (49b6e9a). character: is left out on purpose: v0.9.28
  // makes it a theme namespace (K3), so its body changes by design, and Pokemon never routes it.
  const GOLDEN = [
    ['charizard', {},
      '{"p_words":["charizard"],"p_fields":[],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"relevance","p_dir":"desc","p_limit":60,"p_offset":0}'],
    ['theme:forest', {},
      '{"p_words":[],"p_fields":[{"key":"theme","value":"forest"}],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"relevance","p_dir":"desc","p_limit":60,"p_offset":0}'],
    ['type:fire sort:value', { limit: 90, offset: 60 },
      '{"p_words":[],"p_fields":[{"key":"type","value":"fire"}],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"value","p_dir":"desc","p_limit":90,"p_offset":60}'],
    ['pikachu rarity:rare price>5', { facets: { rarity: ['Rare Holo'] } },
      '{"p_words":["pikachu"],"p_fields":[{"key":"rarity","value":"rare"}],"p_compares":[],"p_facets":{"rarity":["Rare Holo"]},"p_min_price":5,"p_max_price":null,"p_sort":"relevance","p_dir":"desc","p_limit":60,"p_offset":0}'],
    ['theme:water -theme:beach lang:ja', { languages: ['en', 'ja'] },
      '{"p_words":[],"p_fields":[{"key":"theme","value":"water"},{"key":"theme","value":"-beach"}],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"relevance","p_dir":"desc","p_limit":60,"p_offset":0,"p_lang":["ja"]}'],
    ['illustrator:"mitsuhiro arita" hp>=100 sort:name', { languages: ['en'] },
      '{"p_words":[],"p_fields":[{"key":"artist","value":"mitsuhiro arita"}],"p_compares":[{"field":"hp","op":">=","value":"100"}],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"name","p_dir":"asc","p_limit":60,"p_offset":0,"p_lang":["en"]}'],
  ];
  for (const [q, o, want] of GOLDEN) {
    fresh();
    await search.searchCards(query.parseQuery(q), o);
    const rpc = env.log.filter((l) => l.url.includes('/rpc/'));
    assert.deepEqual(rpc.map((l) => l.url), [`${API}/rpc/search_cards`], `(b) ${q}: one search_cards call`);
    assert.equal(rpc[0].raw, want, `(b) ${q}: body`);
  }
  // The Pokemon paid path still posts the search_cards body verbatim (no rpc key) and getToken({ themes }).
  fresh();
  const asked = [];
  configure({ url: PROXY, getToken: async (x) => (asked.push(x), 'tok') });
  env.proxyStatus = 403; // a free account: falls through to the direct call
  await search.searchCards(query.parseQuery('theme:forest'), {});
  assert.equal(env.log.find((l) => l.url === PROXY).raw, GOLDEN[1][2], '(b) proxy body unchanged');
  assert.deepEqual(asked, [{ themes: ['forest'] }], '(b) Pokemon getToken has no game');
  configure(undefined);
  console.log('(b) Pokemon searchCards bodies identical to v0.9.27: ok');
}

// ---------------------------------------------------------------- (c) filterCards
{
  const raw = { 1: ['Anna', 'Common'], 2: ['Elsa', 'Common'], 3: ['Elsa', 'Rare'], 4: ['Olaf', 'Rare'] };
  const small = await catalogM.buildCatalog({
    cards: Object.fromEntries(Object.entries(raw).map(([id, [name, rarity]]) =>
      [id, { id, name, rarity, number: id, set_id: '1', set_name: 'S', series: 'Ser' }])),
    sets: { 1: { id: '1', name: 'S', series: 'Ser' } },
    series: { Ser: { name: 'Ser', set_ids: ['1'] } },
  });
  const rows = ['3', '1', '2', '4'].map((id) => small.getCard(id));
  const parsed = query.parseQuery('theme:forest rarity:rare');
  const local = query.withoutTheme(parsed);
  assert.equal(local.fields.some((f) => f.key === 'theme'), false, '(c) withoutTheme drops the theme fields');
  assert.deepEqual(query.filterCards(rows, local, () => 0).map((c) => c.id), ['3', '4'], '(c) order kept, misses dropped');
  // A theme field on a caption-less row scores 0: left in, it would drop every row.
  assert.deepEqual(query.filterCards(rows, query.parseQuery('theme:forest'), () => 0), [], '(c) theme-only miss');
  assert.deepEqual(query.filterCards(rows, query.withoutTheme(query.parseQuery('theme:forest')), () => 0).map((c) => c.id),
    ['3', '1', '2', '4'], '(c) nothing local: every row, input order');
  console.log('(c) filterCards: ok');
}

// ---------------------------------------------------------------- (d) clamped / degraded / failed
{
  const q = { themes: ['forest'], words: [] };
  fresh({ depth: 3 });
  let p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.deepEqual([p.hits.length, p.total, p.clamped, p.degraded, p.failed], [3, 650, true, false, false], '(d) free: clamped');
  fresh({ depth: 3 });
  p = await search.searchThemes('lorcana', q, { limit: 300, offset: 300 });
  assert.equal(p.clamped, false, '(d) only page 0 is judged');
  fresh({ depth: 0 });
  p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.equal(p.clamped, false, '(d) a full page is not clamped');
  fresh({ depth: 3, total: 2 });
  p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.equal(p.clamped, false, '(d) total under the depth is not clamped');
  // A broken paid endpoint (500) degrades; a refusal (401) is the ordinary free case.
  configure({ url: PROXY, getToken: async () => 'tok' });
  fresh({ depth: 3, proxyStatus: 500 });
  p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.deepEqual([p.clamped, p.degraded], [true, true], '(d) broken proxy: degraded');
  fresh({ depth: 3, proxyStatus: 401 });
  p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.deepEqual([p.clamped, p.degraded], [true, false], '(d) refused proxy: clamped, not degraded');
  configure(undefined);
  fresh({ fail: true });
  p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.deepEqual([p.hits.length, p.failed], [0, true], '(d) a 500 is failed, not empty');
  fresh({ total: 0 });
  p = await search.searchThemes('lorcana', q, { limit: 300 });
  assert.deepEqual([p.hits.length, p.failed], [0, false], '(d) zero rows is an answer');
  fresh();
  p = await search.searchThemes('lorcana', q, { languages: [] });
  assert.equal(env.log.length, 0, '(d) a contradictory language bound makes no call');
  assert.equal(p.failed, false);
  console.log('(d) clamped / degraded / failed: ok');
}

// ---------------------------------------------------------------- (e) mergeThemeHits
{
  const hits = [
    { id: 'a', artBand: 0, fullArt: true, typeGroup: 'Steel' },
    { id: 'zz', artBand: 0, fullArt: true, typeGroup: 'Ruby' },
    { id: 'b', artBand: 1, fullArt: true, typeGroup: 'Amber' },
    { id: 'a', artBand: 2, fullArt: false, typeGroup: 'Steel' },
    { id: 'c', artBand: 2, fullArt: false, typeGroup: 'Ruby' },
    { id: 'd', artBand: 2, fullArt: false, typeGroup: 'Amber' },
  ];
  const have = { a: { id: 'a' }, b: { id: 'b' }, c: { id: 'c' }, d: { id: 'd' } };
  const merged = search.mergeThemeHits(hits, (id) => have[id]);
  assert.deepEqual(merged.map((c) => c.id), ['a', 'b', 'c', 'd'], '(e) unknown id dropped, repeat keeps first');
  assert.deepEqual([merged[0].themeFullArt, merged[0].themeGroup], [true, 'Steel'], '(e) hit facts carried');
  assert.equal(have.a.themeGroup, undefined, '(e) catalog rows are copied, not mutated');
  const grouped = search.mergeThemeHits(hits, (id) => have[id], { groupOrder: ['Amber', 'Ruby'] });
  assert.deepEqual(grouped.map((c) => c.id), ['b', 'd', 'c', 'a'], '(e) registry order, rank within, unlisted last');
  assert.deepEqual(search.mergeThemeHits(hits, (id) => have[id], { keep: (c) => c.id !== 'b' }).map((c) => c.id),
    ['a', 'c', 'd'], '(e) keep pre-filters');
  console.log('(e) mergeThemeHits: ok');
}

// ---------------------------------------------------------------- render harness for (f)-(h)
const cards = {};
for (let i = 0; i < 2000; i++)
  cards['c' + i] = {
    id: 'c' + i, name: 'Card ' + i, number: String(i), rarity: i % 5 === 0 ? 'Rare' : 'Common',
    set_id: '1', set_name: 'Set One', series: 'Ser', release_date: '2024-01-01',
  };
const catalog = await catalogM.buildCatalog({
  cards,
  sets: { 1: { id: '1', name: 'Set One', series: 'Ser' } },
  series: { Ser: { name: 'Ser', set_ids: ['1'] } },
});
const typeGroups = [
  { key: 'Amber', label: 'Amber', color: '#f4b400' },
  { key: 'Ruby', label: 'Ruby', color: '#d33' },
  { key: 'Steel', label: 'Steel', color: '#999' },
];
const lorcana = { game: 'lorcana', typeLabel: 'Ink', typeGroups };
const settle = async () => {
  for (let i = 0; i < 12; i++) await TR.act(async () => { await new Promise((r) => setTimeout(r, 3)); });
};
let r = null;
const mount = async (q, props) => {
  state.browseState.cardQuery = q;
  await TR.act(async () => { r = TR.create(React.createElement(CatalogBrowser, { catalog, footer: null, ...props })); });
  await settle();
};
const unmount = async () => { await TR.act(async () => r.unmount()); r = null; };
const flat = () => r.root.find((n) => n.type === 'FlatList');
const ids = () => flat().props.data.map((it) => it.card?.id);
const walk = (el, pred, out = []) => {
  if (!el || typeof el !== 'object') return out;
  if (Array.isArray(el)) { el.forEach((e) => walk(e, pred, out)); return out; }
  if (pred(el)) out.push(el);
  walk(el.props?.children, pred, out);
  return out;
};
const emptyTexts = () =>
  walk(flat().props.ListEmptyComponent, (e) => e.type?.displayName === 'Text').map((e) => [].concat(e.props.children).join(''));

// ---------------------------------------------------------------- (f) drain before render
{
  fresh({ total: 1500, defer: true });
  await mount('theme:forest sort:value', { themeServer: lorcana });
  assert.equal(calls('theme_search').length, 1, '(f) page 0 asked');
  assert.equal(ids().length, 0, '(f) nothing renders while page 0 is out');
  assert.ok(emptyTexts().includes('Searching…'), '(f) Searching… while loading: ' + emptyTexts());
  env.queue.shift()();
  await settle();
  assert.equal(calls('theme_search').length, 2, '(f) page 1 asked before any row renders');
  assert.equal(ids().length, 0, '(f) nothing renders from a partial drain');
  env.queue.shift()();
  await settle();
  const pages = calls('theme_search').map((c) => [c.body.p_offset, c.body.p_limit]);
  assert.deepEqual(pages, [[0, 1000], [1000, 1000]], '(f) drain pages: ' + JSON.stringify(pages));
  assert.ok(ids().length > 0, '(f) rows render once drained');
  assert.equal(calls('search_cards').length, 0, '(f) never search_cards');
  await unmount();

  // The paid proxy answers page 0 and then breaks: the direct call that stands in is metered, so
  // the RPC pins it to the free top 3 whatever the offset. The drain must stop there (it can no
  // longer be whole) rather than append those 3 rows again until the offset reaches the total.
  fresh({ total: 4000, depth: 3, breakAfter: 1 });
  configure({ url: PROXY, getToken: async () => 'tok' });
  await mount('theme:forest sort:value', { themeServer: lorcana });
  const direct = calls('theme_search').length;
  assert.ok(direct <= 1, '(f) a broken paid drain stops: ' + direct + ' direct calls');
  assert.equal(ids().length, 0, '(f) nothing renders from a drain that cannot be whole');
  assert.ok(emptyTexts().includes('Search is not responding right now.'), '(f) failure view: ' + emptyTexts());
  configure(undefined);
  await unmount();
  console.log('(f) drain: 2 theme_search calls before the first render: ok');
}

// ---------------------------------------------------------------- (g) clamped + grouped
{
  fresh({ depth: 3 });
  state.browseState.themeFrame = 'window'; // Windowed groups by default (decision 7)
  await mount('theme:forest', { themeServer: lorcana });
  const ts = calls('theme_search');
  assert.equal(ts.length, 1);
  assert.equal(ts[0].body.p_group, true, '(g) grouping asked');
  // The server returns c0 Ruby, c1 Amber, c2 Steel by rank; registry order is Amber, Ruby, Steel.
  assert.deepEqual(ids(), ['c1', 'c0', 'c2'], '(g) stable-sorted by typeGroups order');
  assert.deepEqual(flat().props.data.map((it) => it.groupStart?.key), ['Amber', 'Ruby', 'Steel'], '(g) group labels');
  await TR.act(async () => { flat().props.onEndReached?.(); });
  await settle();
  assert.equal(calls('theme_search').length, 1, '(g) nothing to page behind a clamped result');
  await unmount();
  console.log('(g) clamped rows grouped by registry order: ok');
}

// ---------------------------------------------------------------- (h) failure Retry
{
  fresh({ fail: true });
  await mount('theme:forest', { themeServer: lorcana });
  const retry = walk(flat().props.ListEmptyComponent, (e) => e.props?.accessibilityLabel === 'Retry the search');
  assert.equal(retry.length, 1, '(h) the failure view has a Retry');
  env.fail = false;
  const before = calls('theme_search').length;
  await TR.act(async () => { retry[0].props.onPress(); });
  await settle();
  assert.equal(calls('theme_search').length, before + 1, '(h) Retry calls rpc/theme_search');
  assert.equal(calls('search_cards').length, 0, '(h) never rpc/search_cards');
  assert.ok(ids().length > 0, '(h) the retried search renders');
  await unmount();
  console.log('(h) Retry calls theme_search, never search_cards: ok');
}

// ---------------------------------------------------------------- (i) Pokemon toolbar (themeTools)
{
  // search.ts: the fields a toolbar adds, and only to a themed query.
  assert.deepEqual(search.themeToolbarFields({ frame: 'all', types: [], group: false }), [], '(i) defaults add nothing');
  assert.deepEqual(
    search.themeToolbarFields({ frame: 'window', types: ['Fire', 'Trainer'], group: true }),
    [{ key: 'frame', value: 'window' }, { key: 'tgroup', value: 'Fire' }, { key: 'tgroup', value: 'Trainer' }, { key: 'group', value: 'type' }],
    '(i) frame, chips, grouping, in that order',
  );
  const NOTOOL_THEMED =
    '{"p_words":[],"p_fields":[{"key":"theme","value":"forest"}],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"relevance","p_dir":"desc","p_limit":60,"p_offset":0}';
  const NOTOOL_PLAIN =
    '{"p_words":["charizard"],"p_fields":[],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"relevance","p_dir":"desc","p_limit":60,"p_offset":0}';
  fresh();
  await search.searchCards(query.parseQuery('theme:forest'), { toolbar: { frame: 'all', types: [], group: false } });
  assert.equal(calls('search_cards')[0].raw, NOTOOL_THEMED, '(i) a toolbar at its defaults: body identical');
  fresh();
  await search.searchCards(query.parseQuery('charizard'), { toolbar: { frame: 'full', types: ['Fire'], group: true } });
  assert.equal(calls('search_cards')[0].raw, NOTOOL_PLAIN, '(i) a non-themed query never carries the toolbar');
  fresh();
  await search.searchCards(query.parseQuery('theme:forest'), { toolbar: { frame: 'full', types: ['Fire'], group: true } });
  assert.equal(
    calls('search_cards')[0].raw,
    '{"p_words":[],"p_fields":[{"key":"theme","value":"forest"},{"key":"frame","value":"full"},{"key":"tgroup","value":"Fire"},' +
      '{"key":"group","value":"type"}],"p_compares":[],"p_facets":{},"p_min_price":null,"p_max_price":null,"p_sort":"relevance",' +
      '"p_dir":"desc","p_limit":60,"p_offset":0}',
    '(i) toolbar body',
  );

  // search_facets: no toolbar is searchFacets' body exactly; counts only from frame/tgroup rows.
  fresh();
  await search.searchFacets(query.parseQuery('theme:forest'));
  const plainFacets = calls('search_facets')[0].raw;
  fresh();
  let fc = await search.searchFacetsWithCounts(query.parseQuery('theme:forest'));
  assert.equal(calls('search_facets')[0].raw, plainFacets, '(i) facets body without a toolbar unchanged');
  assert.equal(fc.counts, null, '(i) no toolbar, no counts');
  fresh({ poke: { total: 5, facets: [{ facet: 'rarity', value: 'Common', n: 4 }] } });
  fc = await search.searchFacetsWithCounts(query.parseQuery('theme:forest'), {}, undefined, { frame: 'window' });
  assert.equal(fc.counts, null, '(i) a server without toolbar counts: null, chips without numbers');
  assert.deepEqual(fc.facets, { rarity: ['Common'] });
  assert.deepEqual(calls('search_facets')[0].body.p_fields.map((f) => f.key), ['theme', 'frame'], '(i) facets carry the toolbar');
  fresh({ poke: { total: 5, facets: [
    { facet: 'rarity', value: 'Common', n: 4 }, { facet: 'frame', value: 'full', n: 7 }, { facet: 'frame', value: 'window', n: 9 },
    { facet: 'tgroup', value: 'Fire', n: 3 },
  ] } });
  fc = await search.searchFacetsWithCounts(query.parseQuery('theme:forest'), {}, undefined, { frame: 'all' });
  assert.deepEqual(fc.counts, { frame: { full: 7, window: 9 }, type: { Fire: 3 } }, '(i) counts parsed');
  assert.deepEqual(fc.facets, { rarity: ['Common'] }, '(i) toolbar rows never become facet chips');

  // localTypeGroup mirrors _pokemon_type_of (types[0], else Trainer / Energy, else Other).
  const keys = ['Grass', 'Fire', 'Water', 'Colorless', 'Trainer', 'Energy', 'Other'];
  assert.equal(search.localTypeGroup({ types: ['Fire', 'Water'], cardType: ['Pokemon'] }, keys), 'Fire');
  assert.equal(search.localTypeGroup({ types: ['Lightning'], cardType: ['Pokemon'] }, keys), 'Other', '(i) unlisted type: Other');
  assert.equal(search.localTypeGroup({ types: [], cardType: ['Supporter'] }, keys), 'Trainer');
  assert.equal(search.localTypeGroup({ types: [], cardType: ['Energy'] }, keys), 'Energy');
  assert.equal(search.localTypeGroup({ types: [], cardType: ['Pokemon'] }, keys), 'Other');

  // The browser. Registry order Grass, Fire, Water; the stub ranks c0 Water, c1 Fire, c2 Grass, ...
  const pokeGroups = [
    { key: 'Grass', label: 'Grass', color: '#4caf50' },
    { key: 'Fire', label: 'Fire', color: '#e5533d' },
    { key: 'Water', label: 'Water', color: '#3b8de0' },
    { key: 'Trainer', label: 'Trainer', color: '#9aa0a6' },
  ];
  const tools = { typeLabel: 'Energy', typeGroups: pokeGroups };
  const toolbar = () => r.root.findAll((n) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Group by Energy');

  // Off: no prop, even with a persisted Windowed frame, sends exactly the v0.9.28 body; no toolbar.
  fresh({ poke: { total: 5 } });
  state.browseState.themeFrame = 'window';
  await mount('theme:forest', {});
  const offBody = calls('search_cards')[0].raw;
  assert.deepEqual(JSON.parse(offBody).p_fields, [{ key: 'theme', value: 'forest' }], '(i) off: no toolbar fields');
  assert.equal(toolbar().length, 0, '(i) off: no toolbar');
  await unmount();
  // On at its defaults: the same body, and the toolbar shows.
  fresh({ poke: { total: 5 } });
  await mount('theme:forest', { themeTools: tools });
  assert.equal(calls('search_cards')[0].raw, offBody, '(i) on at defaults: body identical to off');
  assert.equal(toolbar().length, 1, '(i) on: toolbar shown for a themed query');
  assert.equal(calls('theme_search').length + calls('theme_facets').length, 0, '(i) Pokemon never calls theme_*');
  await unmount();
  // Not themed: no toolbar.
  fresh({ poke: { total: 5 } });
  await mount('charizard', { themeTools: tools });
  assert.equal(toolbar().length, 0, '(i) no toolbar on an ordinary query');
  await unmount();

  // Clamped + Windowed (groups by default): the request asks for the frame and grouping; the free
  // top 3 come back by rank and are grouped HERE by registry order, labels from the local types.
  fresh({ poke: { total: 50 }, depth: 3 });
  state.browseState.themeFrame = 'window';
  await mount('theme:forest', { themeTools: tools });
  const sc = calls('search_cards');
  assert.deepEqual(sc[0].body.p_fields, [{ key: 'theme', value: 'forest' }, { key: 'frame', value: 'window' }, { key: 'group', value: 'type' }],
    '(i) frame + group sent');
  assert.deepEqual(ids(), ['c2', 'c1', 'c0'], '(i) clamped rows grouped by registry order: ' + ids());
  assert.deepEqual(flat().props.data.map((it) => it.groupStart?.key), ['Grass', 'Fire', 'Water'], '(i) group labels');
  // Picking a chip re-asks the server with it.
  const fire = r.root.findAll((n) => n.type === 'Pressable' && n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel === 'Fire');
  assert.equal(fire.length, 1, '(i) a Fire chip (no counts: plain label)');
  await TR.act(async () => { fire[0].props.onPress(); });
  await settle();
  const last = calls('search_cards').at(-1);
  assert.deepEqual(last.body.p_fields.map((f) => `${f.key}:${f.value}`), ['theme:forest', 'frame:window', 'tgroup:Fire', 'group:type'],
    '(i) chip sent: ' + JSON.stringify(last.body.p_fields));
  await unmount();

  // A server type_group (not returned by 81; a possible later migration) wins over the card's own types.
  fresh({ poke: { total: 50, groups: ['Trainer', 'Grass', 'Fire'] }, depth: 3 });
  state.browseState.themeFrame = 'window';
  await mount('theme:forest', { themeTools: tools });
  assert.deepEqual(ids(), ['c1', 'c2', 'c0'], '(i) grouped by the server type_group: ' + ids());
  assert.deepEqual(flat().props.data.map((it) => it.groupStart?.key), ['Grass', 'Fire', 'Trainer']);
  await unmount();

  // Counts from search_facets reach the toolbar.
  fresh({ poke: { total: 5, facets: [{ facet: 'frame', value: 'full', n: 2 }, { facet: 'frame', value: 'window', n: 3 }, { facet: 'tgroup', value: 'Fire', n: 4 }] } });
  await mount('theme:forest', { themeTools: tools });
  const labels = r.root.findAll((n) => n.type === 'Pressable' && typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel);
  assert.ok(labels.includes('Full art, 2 matches') && labels.includes('All art, 5 matches'), '(i) frame counts: ' + labels.join(' | '));
  assert.ok(labels.includes('Fire, 4 matches') && !labels.includes('Grass'), '(i) chips with counts, zero chips hidden');
  await unmount();

  // Warm themed results page on the server past the first 90 (they used to stop there).
  fresh({ poke: { total: 200 } });
  await mount('theme:forest', { themeTools: tools });
  assert.equal(ids().length, 90, '(i) page 0: 90 rows');
  await TR.act(async () => { flat().props.onEndReached?.(); });
  await settle();
  assert.deepEqual(calls('search_cards').map((c) => c.body.p_offset), [0, 90], '(i) next page asked at offset 90');
  assert.equal(ids().length, 180, '(i) 180 rows after the second page');
  await unmount();

  // A namespace the old regex missed (pokemon:) is a server query, warm or not.
  fresh({ poke: { total: 5 } });
  await mount('pokemon:pikachu', {});
  assert.equal(calls('search_cards').length >= 1, true, '(i) pokemon:pikachu reaches search_cards');
  assert.equal(calls('search_cards')[0].body.p_fields[0].key, 'theme');
  await unmount();
  console.log('(i) Pokemon toolbar: bodies, counts, local grouping, paging past 90: ok');
}

// Pokemon (no themeServer) still routes a themed query to search_cards and never to theme_search.
{
  fresh();
  await mount('theme:forest', {});
  assert.ok(calls('search_cards').length >= 1, 'Pokemon themed query reaches search_cards');
  assert.equal(calls('theme_search').length + calls('theme_facets').length, 0, 'Pokemon never calls theme_*');
  await unmount();
}
console.log('theme server: all assertions passed');
process.exit(0);
