// Verifies resetBrowseData against dist/ with a fake fetch. Loads only the non-React modules.
import assert from 'node:assert/strict';
// Run: npm run check:reset (builds dist first). Uses scripts/dist-resolver.mjs for extensionless imports.
const root = new URL("../dist/", import.meta.url).href;
const load = (m) => import(root + m);
// A deferred fetch so an in-flight load can be made to land AFTER a reset.
const pending = [];
globalThis.fetch = (url) => new Promise((resolve) => pending.push({ url: String(url), resolve }));
const landAll = (body) => { for (const p of pending.splice(0)) p.resolve({ ok: true, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } }); };

const gen = await load('generation.js');
const config = await load('config.js');
const prices = await load('prices.js');
const sealed = await load('sealed.js');
const taxonomy = await load('taxonomy.js');
const search = await load('search.js');

config.configureBrowse({ browseUrl: 'https://a/browse', imgBase: '' });
assert.equal(gen.browseGeneration(), 0, 'first configure does not bump');

// Seed: price summary and taxonomy loaded under A.
const p1 = prices.getPriceSummary();
const t1 = taxonomy.loadTaxonomy();
landAll({ '1': { cur: 5, date: '2026-01-01', variants: {} }, sets: [], series: [] });
await p1; await t1;
assert.ok(prices.priceSnapshot(), 'summary loaded under A');

// Reconfigure to B: caches gone, generation bumped.
let fired = 0;
config.configureBrowse({ browseUrl: 'https://b/browse', imgBase: '' });
assert.equal(gen.browseGeneration(), 1, 'moving browseUrl bumps the generation');
assert.equal(prices.priceSnapshot(), null, 'summary forgotten');
assert.equal(await Promise.race([sealed.loadSealed().then(() => 'started'), Promise.resolve('x')]), 'x');
assert.ok(pending.some((p) => p.url.startsWith('https://b/browse')), 'next load reads B');

// Same URL again: no reset.
config.configureBrowse({ browseUrl: 'https://b/browse', imgBase: '' });
assert.equal(gen.browseGeneration(), 1, 'same URL does not bump');

// In-flight guard: a summary load started under B must not publish after a switch to C.
pending.length = 0;
const stale = prices.getPriceSummary();
config.configureBrowse({ browseUrl: 'https://c/browse', imgBase: '' });
assert.equal(gen.browseGeneration(), 2);
landAll({ '9': { cur: 1, date: '2026-01-01', variants: {} } });
await stale;
assert.equal(prices.priceSnapshot(), null, 'a stale load does not publish');
const fresh = prices.getPriceSummary();
landAll({ '7': { cur: 2, date: '2026-01-01', variants: {} } });
await fresh;
assert.ok(prices.priceSnapshot()?.['7'], 'the current load publishes');

// resetBrowseData on its own.
config.resetBrowseData();
assert.equal(gen.browseGeneration(), 3);
assert.equal(prices.priceSnapshot(), null);
assert.equal(typeof search._resetSearchCaches, 'function');
console.log('kit reset: all assertions passed');
