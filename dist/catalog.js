/**
 * Catalog data-access layer — the taxonomy-rich `catalog.json` published by the
 * tcgscan-data pipeline (card names, set/series structure, image tiers,
 * enrichment facts), behind the `Catalog` interface. All data-shape knowledge
 * (raw snake_case → camelCase normalization, Map-backed lookups) lives here.
 *
 * Shared by michi-maker and tcgscan-app; app-specific view-model adapters
 * (e.g. michi's catalogCardToDemoCard) stay in the apps.
 */
import { getBrowseUrl } from './config';
/**
 * A card's footprint kind. The oversized flag (`jumbo: bool`) is the real signal in
 * today's slim catalog; `raw.kind` is a legacy string kept only so an older fat catalog
 * still resolves. (V-UNION is derived separately from `vunionGroups`, not from here.)
 */
function cardKind(raw) {
    if (raw.jumbo)
        return 'jumbo';
    return raw.kind === 'jumbo' || raw.kind === 'vunion' ? raw.kind : 'standard';
}
/** Sort key for collector numbers: "12/102" -> 12, "SWSH045" -> 45, "" -> ∞. */
function numberKey(n) {
    const m = n.match(/\d+/);
    return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** yyyy-mm-dd -> "Mar 2022" (or "" for empty). */
export function formatSetDate(iso) {
    if (!iso)
        return '';
    const [y, m] = iso.split('-');
    return `${MONTHS[parseInt(m, 10) - 1] ?? ''} ${y}`.trim();
}
/** A series' active-years label from its first/last set, e.g. "2016–2018" or "2016". */
export function seriesDateRange(s) {
    const y1 = s.firstDate.slice(0, 4);
    const y2 = s.releaseDate.slice(0, 4);
    if (!y1)
        return y2;
    if (!y2 || y1 === y2)
        return y1;
    return `${y1}–${y2}`;
}
/** Newest release first; empty dates sink to the bottom; ties broken by name. */
function byReleaseDesc(a, b) {
    return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name);
}
class LocalCatalog {
    constructor(raw) {
        this.cards = new Map();
        this.cardsBySet = new Map();
        this.sets = new Map();
        this.series = new Map();
        this.all = [];
        this.jumbo = [];
        this.vunion = [];
        // Parallel search index: card names pre-lowercased once so name search doesn't
        // re-lowercase ~28k strings on every keystroke.
        this.searchIndex = [];
        // Set-level attributes (name/code/series) are stored ONCE per set, not stamped
        // onto every card — the normalized catalog drops the per-card copies. Build a
        // lookup so each card can derive them from its set_id. `raw_c.set_name ?? …`
        // keeps reading the old fat catalog (which still carries them) unchanged.
        const setMeta = new Map();
        for (const raw_s of Object.values(raw.sets)) {
            setMeta.set(String(raw_s.id), {
                name: raw_s.name ?? '',
                code: raw_s.code ?? '',
                series: raw_s.series ?? '',
            });
        }
        for (const raw_c of Object.values(raw.cards)) {
            const setId = String(raw_c.set_id ?? '');
            const meta = setMeta.get(setId);
            const card = {
                id: String(raw_c.id),
                name: raw_c.name ?? '',
                number: raw_c.number ?? '',
                rarity: raw_c.rarity ?? '',
                cardType: raw_c.card_type ?? [],
                setId,
                setName: raw_c.set_name ?? meta?.name ?? '',
                setCode: raw_c.set_code ?? meta?.code ?? '',
                seriesId: raw_c.series ?? meta?.series ?? '',
                releaseDate: raw_c.release_date ?? '',
                image: raw_c.image ?? '',
                kind: cardKind(raw_c),
                illustrator: raw_c.illustrator ?? '',
                types: raw_c.types ?? [],
                stage: raw_c.stage ?? '',
                hp: typeof raw_c.hp === 'number' ? raw_c.hp : null,
                // 0-indexed → 1-indexed (Basic = 1); -1 when the pipeline had no evolution data.
                evolutionStage: typeof raw_c.evolution_stage_index === 'number' ? raw_c.evolution_stage_index + 1 : -1,
                imageSmall: raw_c.image_small,
                imageMedium: raw_c.image_medium,
                imageSubstituted: raw_c.imageSubstituted,
            };
            this.cards.set(card.id, card);
            this.all.push(card);
            if (card.kind === 'jumbo')
                this.jumbo.push(card);
            this.searchIndex.push({ card, lc: card.name.toLowerCase() });
            let bucket = this.cardsBySet.get(card.setId);
            if (!bucket)
                this.cardsBySet.set(card.setId, (bucket = []));
            bucket.push(card);
        }
        // V-UNION groups: keep only well-formed groups whose four piece ids all resolve.
        for (const g of raw.vunionGroups ?? []) {
            const pieces = g.pieces ?? [];
            if (pieces.length !== 4)
                continue;
            if (!pieces.every((id) => this.cards.has(String(id))))
                continue;
            const base = g.base ?? '';
            this.vunion.push({
                base,
                label: g.label ?? `${base} V-UNION`,
                pieces: pieces.map(String),
            });
        }
        for (const raw_s of Object.values(raw.sets)) {
            const id = String(raw_s.id);
            const cards = this.cardsBySet.get(id) ?? [];
            const dates = cards.map((c) => c.releaseDate).filter(Boolean).sort(); // yyyy-mm-dd sorts lexically
            this.sets.set(id, {
                id,
                name: raw_s.name ?? id,
                code: raw_s.code ?? '',
                seriesId: raw_s.series ?? '',
                cardCount: raw_s.card_count ?? cards.length,
                coverUri: raw_s.logo, // official set logo if matched, else blank
                releaseDate: dates[0] ?? '',
                lastPrinted: dates[dates.length - 1] ?? '',
            });
        }
        for (const raw_series of Object.values(raw.series)) {
            const setIds = (raw_series.set_ids ?? []).map(String);
            const setsInSeries = setIds
                .map((sid) => this.sets.get(sid))
                .filter((s) => Boolean(s));
            const setDates = setsInSeries
                .map((s) => s.releaseDate)
                .filter((d) => Boolean(d))
                .sort();
            this.series.set(raw_series.name, {
                id: raw_series.name,
                name: raw_series.name,
                setIds,
                cardCount: raw_series.card_count ?? 0,
                coverUri: raw_series.logo, // dedicated series-art image, else blank
                firstDate: setDates[0] ?? '',
                releaseDate: setDates[setDates.length - 1] ?? '',
            });
        }
    }
    get cardCount() {
        return this.all.length;
    }
    listSeries() {
        return [...this.series.values()].sort(byReleaseDesc);
    }
    getSeries(seriesId) {
        return this.series.get(seriesId);
    }
    listSets(seriesId) {
        const series = this.series.get(seriesId);
        if (!series)
            return [];
        return series.setIds
            .map((id) => this.sets.get(id))
            .filter((s) => Boolean(s))
            .sort(byReleaseDesc);
    }
    getSet(setId) {
        return this.sets.get(setId);
    }
    listCards(setId) {
        return [...(this.cardsBySet.get(setId) ?? [])].sort((a, b) => numberKey(a.number) - numberKey(b.number) || a.name.localeCompare(b.name));
    }
    getCard(cardId) {
        return this.cards.get(cardId);
    }
    allSets() {
        return [...this.sets.values()].sort(byReleaseDesc);
    }
    recentCards(limit = 24) {
        return this.all
            .filter((c) => c.releaseDate)
            .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
            .slice(0, limit);
    }
    upcomingCards(today, limit = 40) {
        return this.all
            .filter((c) => c.releaseDate && c.releaseDate > today)
            .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.name.localeCompare(b.name))
            .slice(0, limit);
    }
    releasedCards(today, limit = 40) {
        return this.all
            .filter((c) => c.releaseDate && c.releaseDate <= today)
            .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
            .slice(0, limit);
    }
    listAll() {
        return this.all;
    }
    listJumbo() {
        return [...this.jumbo].sort((a, b) => a.name.localeCompare(b.name) || numberKey(a.number) - numberKey(b.number));
    }
    vunionGroups() {
        return [...this.vunion];
    }
    search(query, limit = 60) {
        // Full scan over the pre-lowercased index (cheap at ~28k): prefix matches rank
        // first and are never dropped by an early break — we only stop once we already
        // have a full page of prefix hits. `contains` is capped so it can't grow unbounded.
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        const starts = [];
        const contains = [];
        for (const { card, lc } of this.searchIndex) {
            const idx = lc.indexOf(q);
            if (idx < 0)
                continue;
            if (idx === 0) {
                starts.push(card);
                if (starts.length >= limit)
                    break;
            }
            else if (contains.length < limit) {
                contains.push(card);
            }
        }
        return [...starts, ...contains].slice(0, limit);
    }
    searchSeries(query, limit = 6) {
        return matchByName([...this.series.values()], (s) => s.name, query, limit);
    }
    searchSets(query, limit = 12) {
        // match a set by its own name or its series name (so "swor" surfaces sets too)
        return matchByName([...this.sets.values()], (s) => `${s.name} ${s.seriesId}`, query, limit, (s) => s.name);
    }
}
/**
 * Prefix-boosted substring match: items whose (rank) text starts with the query
 * come first, then substring hits — capped at `limit`. `rankText` defaults to
 * `text`; pass a narrower one when `text` includes extra searchable context.
 */
function matchByName(items, text, query, limit, rankText) {
    const q = query.trim().toLowerCase();
    if (!q)
        return [];
    const rank = rankText ?? text;
    const starts = [];
    const contains = [];
    for (const item of items) {
        const hay = text(item).toLowerCase();
        if (!hay.includes(q))
            continue;
        if (rank(item).toLowerCase().startsWith(q))
            starts.push(item);
        else
            contains.push(item);
        if (starts.length + contains.length >= limit * 3)
            break; // bound work on huge lists
    }
    return [...starts, ...contains].slice(0, limit);
}
async function loadCatalogFrom(base) {
    const res = await fetch(`${base}/catalog.json`);
    if (!res.ok)
        throw new Error(`Failed to load catalog.json (${res.status})`);
    return new LocalCatalog((await res.json()));
}
let cache = null;
let loaded = null;
const subscribers = new Set();
/**
 * Subscribe to catalog-loaded notifications. The callback fires once, when the shared
 * catalog finishes loading (i.e. when `getLoadedCatalog()` flips from null to the catalog).
 * Lets components reactively pick up the catalog *without* forcing the fetch themselves.
 * Returns an unsubscribe function.
 */
export function subscribeCatalog(callback) {
    subscribers.add(callback);
    return () => {
        subscribers.delete(callback);
    };
}
/**
 * Shared, load-once catalog: the fetch + parse happens exactly once app-wide
 * (module-level promise cache), regardless of how many callers await it.
 */
export function loadCatalog() {
    if (!cache) {
        cache = loadCatalogFrom(getBrowseUrl())
            .then((c) => {
            loaded = c; // publish a synchronous snapshot for non-async callers (see getLoadedCatalog)
            subscribers.forEach((cb) => cb());
            return c;
        })
            .catch((e) => {
            cache = null; // don't poison the cache — let a later mount retry the fetch
            throw e;
        });
    }
    return cache;
}
/** Alias of {@link loadCatalog} — the shared, load-once catalog promise. */
export function getCatalog() {
    return loadCatalog();
}
/**
 * Fire-and-forget, low-priority warm of the shared catalog. Kicks off the load-once
 * fetch/parse without making any caller await it, and swallows errors (on failure
 * `loadCatalog` already clears its cache so a later mount retries).
 */
export function prefetchCatalog() {
    loadCatalog().catch(() => {
        // Swallowed on purpose: this is a background warm, not a subscriber. A later
        // useCatalog mount surfaces the error and retries the (now-cleared) cache.
    });
}
/**
 * Synchronous access to the catalog *iff* it has already resolved, else `null`.
 * Lets render-path code read the catalog without awaiting — callers must handle
 * the `null` (still-loading) case with a fallback. Does NOT kick off a load.
 */
export function getLoadedCatalog() {
    return loaded;
}
