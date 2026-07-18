/**
 * Sealed products — the pipeline's `browse/sealed.json` (booster boxes, ETBs, collection
 * boxes …, ~2.9k products with mirrored image tiers) + their headline values from
 * `browse/prices-summary-sealed.json` (kept separate from the card summary so either lane
 * can republish alone). Both are small public artifacts, so a sealed carousel renders
 * WITHOUT the card catalog — usable by guests / before any catalog load.
 *
 * Load-once module caches + a React hook, mirroring prices.ts / catalog.ts patterns.
 */
import { useEffect, useState } from 'react';
import { getBrowseUrl } from './config';
/** Derive a sealed product's printing language. Prefers an explicit `language` field (stamped by
 *  the combined publish); falls back to the pipeline's ' -JP' series-name suffix for artifacts
 *  published before the field existed. Defaults to English. */
export function sealedLanguageOf(p) {
    if (p.language === 'ja' || p.language === 'en')
        return p.language;
    return p.series?.endsWith(' -JP') ? 'ja' : 'en';
}
class LocalSealed {
    constructor(raw) {
        this.products = [];
        this.sets = new Map();
        this.sorted = null;
        for (const p of Object.values(raw.products ?? {})) {
            this.products.push({
                id: String(p.id),
                name: p.name ?? '',
                setId: String(p.set_id ?? ''),
                series: p.series ?? '',
                releaseDate: p.release_date ?? '',
                image: p.image ?? '',
                imageSmall: p.image_small ?? '',
                imageMedium: p.image_medium ?? '',
                language: sealedLanguageOf(p),
            });
        }
        for (const s of Object.values(raw.sets ?? {})) {
            const id = String(s.id);
            this.sets.set(id, {
                id,
                name: s.name ?? id,
                code: s.code ?? '',
                series: s.series ?? '',
                productCount: s.product_count ?? 0,
            });
        }
    }
    newestFirst() {
        if (!this.sorted) {
            this.sorted = [...this.products].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name));
        }
        return this.sorted;
    }
}
let sealedPromise = null;
let sealedLoaded = null;
let sealedPricesPromise = null;
let sealedPricesLoaded = null;
/** Load-once sealed catalog (browse/sealed.json). */
export function loadSealed() {
    if (!sealedPromise) {
        sealedPromise = fetch(`${getBrowseUrl()}/sealed.json`)
            .then(async (res) => {
            if (!res.ok)
                throw new Error(`sealed.json ${res.status}`);
            sealedLoaded = new LocalSealed((await res.json()));
            return sealedLoaded;
        })
            .catch((e) => {
            sealedPromise = null; // allow a later retry
            throw e;
        });
    }
    return sealedPromise;
}
/** Load-once sealed headline values: product id -> cur (prices-summary-sealed.json). */
export function loadSealedPrices() {
    if (!sealedPricesPromise) {
        sealedPricesPromise = fetch(`${getBrowseUrl()}/prices-summary-sealed.json`)
            .then(async (res) => {
            if (!res.ok)
                return {};
            const raw = (await res.json());
            const out = {};
            for (const [id, v] of Object.entries(raw))
                out[id] = Number(v?.cur) || 0;
            sealedPricesLoaded = out;
            return out;
        })
            .catch(() => ({})); // prices are decoration — fail soft
    }
    return sealedPricesPromise;
}
/**
 * React hook: the sealed catalog + prices, loading both once app-wide. `sealed` is null
 * until loaded (fail → stays null and a later mount retries); prices default to {}.
 */
export function useSealed() {
    const [sealed, setSealed] = useState(sealedLoaded);
    const [prices, setPrices] = useState(sealedPricesLoaded ?? {});
    useEffect(() => {
        let cancelled = false;
        loadSealed().then((s) => !cancelled && setSealed(s), () => { });
        loadSealedPrices().then((p) => !cancelled && setPrices(p));
        return () => {
            cancelled = true;
        };
    }, []);
    return { sealed, priceOf: (id) => prices[id] ?? 0 };
}
