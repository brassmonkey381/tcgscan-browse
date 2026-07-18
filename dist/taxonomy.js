/**
 * Series → Set taxonomy WITHOUT the catalog — the pipeline's tiny public
 * `browse/taxonomy.json` (sets + series with logos, counts, and precomputed per-set release
 * dates; no cards). Powers the COLD-mode drill-down: the browser walks Series → Set from
 * here and fetches each set's cards from the server on drill (see search.fetchSetCards).
 *
 * Implements the same list/get surface (and ordering) as the full catalog, so the browser
 * renders either source identically.
 */
import { useEffect, useState } from 'react';
import { resolveLanguage } from './catalog';
import { getBrowseUrl } from './config';
/** Newest release first; empty dates sink; ties by name — matches the catalog ordering. */
function byReleaseDesc(a, b) {
    return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name);
}
class LocalTaxonomy {
    constructor(raw) {
        this.sets = new Map();
        this.series = new Map();
        this.cardCount = raw.counts?.cards ?? 0;
        for (const s of Object.values(raw.sets ?? {})) {
            const id = String(s.id);
            this.sets.set(id, {
                id,
                name: s.name ?? id,
                code: s.code ?? '',
                seriesId: s.series ?? '',
                cardCount: s.card_count ?? 0,
                coverUri: s.logo,
                releaseDate: s.release_date ?? '',
                lastPrinted: s.last_printed ?? '',
                // No cards cold — derive from the set's SERIES name (which carries the " -JP" marker).
                language: resolveLanguage(s.language, s.series ?? s.name ?? ''),
            });
        }
        for (const raw_series of Object.values(raw.series ?? {})) {
            const setIds = (raw_series.set_ids ?? []).map(String);
            const dates = setIds
                .map((sid) => this.sets.get(sid)?.releaseDate)
                .filter((d) => Boolean(d))
                .sort();
            this.series.set(raw_series.name, {
                id: raw_series.name,
                name: raw_series.name,
                setIds,
                cardCount: raw_series.card_count ?? 0,
                coverUri: raw_series.logo,
                firstDate: dates[0] ?? '',
                releaseDate: dates[dates.length - 1] ?? '',
                language: resolveLanguage(raw_series.language, raw_series.name),
            });
        }
    }
    listSeries() {
        return [...this.series.values()].sort(byReleaseDesc);
    }
    listSets(seriesId) {
        const s = this.series.get(seriesId);
        if (!s)
            return [];
        return s.setIds
            .map((id) => this.sets.get(id))
            .filter((x) => Boolean(x))
            .sort(byReleaseDesc);
    }
    getSeries(seriesId) {
        return this.series.get(seriesId);
    }
    getSet(setId) {
        return this.sets.get(setId);
    }
}
let taxPromise = null;
let taxLoaded = null;
/** Load-once taxonomy (browse/taxonomy.json). Rejects propagate; a later call retries. */
export function loadTaxonomy() {
    if (!taxPromise) {
        taxPromise = fetch(`${getBrowseUrl()}/taxonomy.json`)
            .then(async (res) => {
            if (!res.ok)
                throw new Error(`taxonomy.json ${res.status}`);
            taxLoaded = new LocalTaxonomy((await res.json()));
            return taxLoaded;
        })
            .catch((e) => {
            taxPromise = null;
            throw e;
        });
    }
    return taxPromise;
}
/**
 * React hook: the taxonomy when `enabled` (cold mode), null while loading / when disabled.
 * Fail-soft: on fetch failure it stays null (the browser then shows the type-to-search idle).
 */
export function useTaxonomy(enabled) {
    const [tax, setTax] = useState(taxLoaded);
    useEffect(() => {
        if (!enabled || tax)
            return;
        let cancelled = false;
        loadTaxonomy().then((t) => !cancelled && setTax(t), () => { });
        return () => {
            cancelled = true;
        };
    }, [enabled, tax]);
    return tax;
}
