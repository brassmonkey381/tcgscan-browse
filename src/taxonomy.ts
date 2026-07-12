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

import type { CatalogSeries, CatalogSet } from './catalog';
import { getBrowseUrl } from './config';

/** The subset of the catalog surface the drill-down needs (Catalog satisfies this). */
export interface TaxonomySource {
  listSeries(): CatalogSeries[];
  listSets(seriesId: string): CatalogSet[];
  getSeries(seriesId: string): CatalogSeries | undefined;
  getSet(setId: string): CatalogSet | undefined;
  /** Total browse card count (for the search placeholder), when known. */
  readonly cardCount?: number;
}

interface RawTaxSet {
  id: string | number;
  name?: string;
  code?: string;
  series?: string;
  card_count?: number;
  logo?: string;
  release_date?: string;
  last_printed?: string;
}
interface RawTaxSeries {
  name: string;
  set_ids?: (string | number)[];
  card_count?: number;
  logo?: string;
}
interface RawTaxonomy {
  counts?: { cards?: number };
  sets: Record<string, RawTaxSet>;
  series: Record<string, RawTaxSeries>;
}

/** Newest release first; empty dates sink; ties by name — matches the catalog ordering. */
function byReleaseDesc(
  a: { releaseDate: string; name: string },
  b: { releaseDate: string; name: string },
): number {
  return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name);
}

class LocalTaxonomy implements TaxonomySource {
  private readonly sets = new Map<string, CatalogSet>();
  private readonly series = new Map<string, CatalogSeries>();
  /** Total card count across the browse (for the search placeholder), 0 if unknown. */
  readonly cardCount: number;

  constructor(raw: RawTaxonomy) {
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
      });
    }
    for (const raw_series of Object.values(raw.series ?? {})) {
      const setIds = (raw_series.set_ids ?? []).map(String);
      const dates = setIds
        .map((sid) => this.sets.get(sid)?.releaseDate)
        .filter((d): d is string => Boolean(d))
        .sort();
      this.series.set(raw_series.name, {
        id: raw_series.name,
        name: raw_series.name,
        setIds,
        cardCount: raw_series.card_count ?? 0,
        coverUri: raw_series.logo,
        firstDate: dates[0] ?? '',
        releaseDate: dates[dates.length - 1] ?? '',
      });
    }
  }

  listSeries(): CatalogSeries[] {
    return [...this.series.values()].sort(byReleaseDesc);
  }
  listSets(seriesId: string): CatalogSet[] {
    const s = this.series.get(seriesId);
    if (!s) return [];
    return s.setIds
      .map((id) => this.sets.get(id))
      .filter((x): x is CatalogSet => Boolean(x))
      .sort(byReleaseDesc);
  }
  getSeries(seriesId: string): CatalogSeries | undefined {
    return this.series.get(seriesId);
  }
  getSet(setId: string): CatalogSet | undefined {
    return this.sets.get(setId);
  }
}

let taxPromise: Promise<LocalTaxonomy> | null = null;
let taxLoaded: LocalTaxonomy | null = null;

/** Load-once taxonomy (browse/taxonomy.json). Rejects propagate; a later call retries. */
export function loadTaxonomy(): Promise<TaxonomySource> {
  if (!taxPromise) {
    taxPromise = fetch(`${getBrowseUrl()}/taxonomy.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`taxonomy.json ${res.status}`);
        taxLoaded = new LocalTaxonomy((await res.json()) as RawTaxonomy);
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
export function useTaxonomy(enabled: boolean): TaxonomySource | null {
  const [tax, setTax] = useState<TaxonomySource | null>(taxLoaded);
  useEffect(() => {
    if (!enabled || tax) return;
    let cancelled = false;
    loadTaxonomy().then(
      (t) => !cancelled && setTax(t),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, tax]);
  return tax;
}
