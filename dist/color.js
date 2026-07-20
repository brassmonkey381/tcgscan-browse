/**
 * Color similarity client — two features over per-card dominant colors:
 *   1. PICKER   — pick a color, get cards whose palette prominently features it.
 *   2. SIMILAR  — from one card, get cards with the nearest palette ("find similar by color").
 * Both support a REGION toggle: 'noborder' (full card face) vs 'art' (illustration only).
 *
 * HYBRID (mirrors the embedding path): compute on-device when a client is WARM (the small
 * color blob is loaded), else fall back to the data server's RPCs (guest / gated / cold). Both
 * paths use the identical CIELAB values + metric, so results match. See tcgscan-data-science's
 * docs/COLOR-SIMILARITY.md for the full data contract.
 *
 * Fails soft everywhere — color search is a bonus, never a dependency.
 */
import { useEffect, useState } from 'react';
import { getApiKey, getApiUrl, getColorUrl } from './config';
const RPC_TIMEOUT_MS = 12000;
function fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
    return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
/** True when the data server's REST API is reachable (the server color path can run). */
export function colorServerAvailable() {
    return Boolean(getApiUrl() && getApiKey());
}
// ---- sRGB <-> CIELAB (mirror rgb_to_lab in tcgscan/analysis/colors.py) --------------------
/** sRGB (0..255) → CIELAB. Feed a picked swatch through this before searchByColor. */
export function srgbToLab(r, g, b) {
    const lin = (c) => {
        const cc = c / 255;
        return cc <= 0.04045 ? cc / 12.92 : ((cc + 0.055) / 1.055) ** 2.4;
    };
    const R = lin(r), G = lin(g), B = lin(b);
    let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    let Y = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 1.0;
    let Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    X = f(X);
    Y = f(Y);
    Z = f(Z);
    return { L: 116 * Y - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
}
/** CIELAB → sRGB (0..255), for drawing a card's stored-color swatches. */
export function labToSrgb(L, a, b) {
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
    let X = inv(fx) * 0.95047, Y = inv(fy) * 1.0, Z = inv(fz) * 1.08883;
    const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    const Bb = 0.0557 * X - 0.204 * Y + 1.057 * Z;
    const gam = (c) => {
        const cc = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return Math.max(0, Math.min(255, Math.round(cc * 255)));
    };
    return { r: gam(R), g: gam(G), b: gam(Bb) };
}
function dE(x, y) {
    const dL = x.L - y.L, da = x.a - y.a, db = x.b - y.b;
    return Math.sqrt(dL * dL + da * da + db * db);
}
/**
 * On-device color index — loads the packed `card_colors.bin` (+ ids + meta) and computes both
 * features locally in a few ms. Layout is read from the meta (never hardcoded). See the data
 * contract in docs/COLOR-SIMILARITY.md.
 */
export class ColorIndex {
    constructor() {
        this.buf = new Uint8Array(0);
        this.ids = [];
        this.rowOf = new Map();
        this.regions = [];
        this.k = 0;
        this.bpcolor = 0;
        this.bpcard = 0;
        /** True once the blob is parsed. */
        this.ready = false;
    }
    /** Load the three files from `base` (a URL dir). Resolves even on failure — check `ready`. */
    async load(base) {
        const [meta, ids, bin] = await Promise.all([
            fetch(`${base}/card_colors_meta.json`).then((r) => r.json()),
            fetch(`${base}/card_colors_ids.json`).then((r) => r.json()),
            fetch(`${base}/card_colors.bin`).then((r) => r.arrayBuffer()),
        ]);
        this.regions = meta.regions;
        this.k = meta.colors_per_card;
        this.bpcolor = meta.bytes_per_color;
        this.bpcard = meta.bytes_per_card;
        this.ids = ids;
        this.buf = new Uint8Array(bin);
        this.rowOf.clear();
        ids.forEach((id, i) => this.rowOf.set(id, i));
        this.ready = true;
    }
    /** Is this card in the color index? */
    has(productId) {
        return this.rowOf.has(productId);
    }
    /** The card's dominant colors for one region (empty if absent). */
    colors(productId, region) {
        const r = this.rowOf.get(productId);
        if (r === undefined)
            return [];
        const ri = this.regions.indexOf(region);
        if (ri < 0)
            return [];
        const off = r * this.bpcard + ri * this.k * this.bpcolor;
        const out = [];
        for (let c = 0; c < this.k; c += 1) {
            const p = off + c * this.bpcolor;
            out.push({ L: this.buf[p], a: this.buf[p + 1] - 128, b: this.buf[p + 2] - 128, w: this.buf[p + 3] / 255 });
        }
        return out;
    }
    /** Symmetric weighted color-set distance — mirrors the server/pipeline metric. */
    static setDist(A, B) {
        let q2c = 0, c2q = 0;
        for (const a of A)
            q2c += a.w * Math.min(...B.map((b) => dE(a, b)));
        for (const b of B)
            c2q += b.w * Math.min(...A.map((a) => dE(a, b)));
        return 0.5 * (q2c + c2q);
    }
    /** MODAL: cards with the palette most similar to `productId` (nearest first). */
    findSimilar(productId, region, topN = 30) {
        const q = this.colors(productId, region);
        if (!q.length)
            return [];
        const out = [];
        for (const id of this.ids) {
            if (id === productId)
                continue;
            out.push({ id, score: ColorIndex.setDist(q, this.colors(id, region)) });
        }
        return out.sort((p, r) => p.score - r.score).slice(0, topN);
    }
    /** PICKER: cards that prominently feature `pick` (LAB). `lambda` biases toward dominant colors. */
    searchByColor(pick, region, topN = 60, lambda = 25) {
        const p = { ...pick, w: 1 };
        const out = [];
        for (const id of this.ids) {
            const cs = this.colors(id, region);
            if (!cs.length)
                continue;
            const score = Math.min(...cs.map((c) => dE(p, c) - lambda * c.w));
            out.push({ id, score });
        }
        return out.sort((x, y) => x.score - y.score).slice(0, topN);
    }
    /**
     * MULTI-COLOR PICKER: cards whose palette best matches a WEIGHTED query palette (up to 3 colors
     * with weights). Uses the SAME symmetric weighted set-distance as findSimilar — the query palette
     * plays the role of a card. Weights need not sum to 1 (the metric is coverage-weighted either way).
     */
    searchByColors(query, region, topN = 60) {
        const q = query.filter((c) => c.w > 0);
        if (!q.length)
            return [];
        const out = [];
        for (const id of this.ids) {
            const cs = this.colors(id, region);
            if (!cs.length)
                continue;
            out.push({ id, score: ColorIndex.setDist(q, cs) });
        }
        return out.sort((x, y) => x.score - y.score).slice(0, topN);
    }
}
// Load-once module index (Path A). Null until loaded / after a failed load.
let indexPromise = null;
let indexLoaded = null;
/** Load-once on-device color index from the configured color URL. Fails soft → null. */
export function loadColorIndex() {
    if (!indexPromise) {
        const idx = new ColorIndex();
        indexPromise = idx
            .load(getColorUrl())
            .then(() => {
            indexLoaded = idx;
            return idx;
        })
            .catch(() => {
            indexPromise = null; // allow a later retry
            return null;
        });
    }
    return indexPromise;
}
/** The loaded on-device index, or null if not (yet) loaded. */
export function getColorIndex() {
    return indexLoaded;
}
/**
 * React hook: kicks off the on-device index load when `enabled` and returns it once ready (null
 * until then). Wire `enabled` to "warm" clients (signed-in / bundled) so the first color tap is
 * already local; guests can leave it false and use the server path. Fail-soft: stays null on error.
 */
export function useColorIndex(enabled) {
    const [idx, setIdx] = useState(indexLoaded);
    useEffect(() => {
        if (!enabled || idx)
            return;
        let cancelled = false;
        loadColorIndex().then((i) => {
            if (!cancelled && i)
                setIdx(i);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, idx]);
    return idx;
}
// ---- Path B: server RPCs -----------------------------------------------------------------
/** PICKER via the server: cards prominently featuring `pick`. Fails soft ([]). */
export async function searchByColorServer(pick, region, { limit = 60, lambda = 25 } = {}) {
    if (!colorServerAvailable())
        return [];
    try {
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/search_by_color`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_region: region, p_l: pick.L, p_a: pick.a, p_b: pick.b, p_limit: limit, p_lambda: lambda }),
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({ id: r.product_id, score: r.score }));
    }
    catch {
        return [];
    }
}
/** MULTI-COLOR PICKER via the server: cards matching a weighted query palette. Fails soft ([]). */
export async function searchByColorsServer(query, region, { limit = 60 } = {}) {
    const q = query.filter((c) => c.w > 0);
    if (!colorServerAvailable() || !q.length)
        return [];
    try {
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/search_by_colors`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_region: region, p_colors: q.map((c) => [c.L, c.a, c.b, c.w]), p_limit: limit }),
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({ id: r.product_id, score: r.dist }));
    }
    catch {
        return [];
    }
}
/** MODAL via the server: cards with the nearest palette to `productId`. Fails soft ([]). */
export async function findSimilarByColorServer(productId, region, { limit = 30 } = {}) {
    if (!colorServerAvailable() || !productId)
        return [];
    try {
        const res = await fetchWithTimeout(`${getApiUrl()}/rpc/find_similar_by_color`, {
            method: 'POST',
            headers: { apikey: getApiKey(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_product_id: productId, p_region: region, p_limit: limit }),
        });
        if (!res.ok)
            return [];
        const rows = (await res.json());
        return rows.map((r) => ({ id: r.product_id, score: r.dist }));
    }
    catch {
        return [];
    }
}
// ---- Hybrid (prefer on-device when warm, else server) ------------------------------------
/** True when EITHER color path is usable (on-device index loaded, or server reachable). */
export function colorSearchAvailable() {
    return Boolean(indexLoaded) || colorServerAvailable();
}
/**
 * PICKER (hybrid): ids of cards prominently featuring `pick`, nearest first. Uses the on-device
 * index when loaded, else the server RPC. Returns ids only (resolve via catalog / fetchCardsByIds).
 */
export async function searchByColor(pick, region, opts = {}) {
    if (indexLoaded)
        return indexLoaded.searchByColor(pick, region, opts.limit ?? 60, opts.lambda ?? 25).map((h) => h.id);
    return (await searchByColorServer(pick, region, opts)).map((h) => h.id);
}
/**
 * MULTI-COLOR PICKER (hybrid): ids of cards best matching a weighted query palette (up to 3 colors
 * with weights), nearest first. On-device when the index is loaded, else the server RPC.
 */
export async function searchByColors(query, region, opts = {}) {
    if (indexLoaded)
        return indexLoaded.searchByColors(query, region, opts.limit ?? 60).map((h) => h.id);
    return (await searchByColorsServer(query, region, opts)).map((h) => h.id);
}
/**
 * MODAL (hybrid): ids of cards with the palette nearest `productId`, nearest first. On-device when
 * the index holds the card, else the server RPC. Returns ids only.
 */
export async function findSimilarByColor(productId, region, opts = {}) {
    if (indexLoaded?.has(productId))
        return indexLoaded.findSimilar(productId, region, opts.limit ?? 30).map((h) => h.id);
    return (await findSimilarByColorServer(productId, region, opts)).map((h) => h.id);
}
