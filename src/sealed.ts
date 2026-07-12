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

export interface SealedProduct {
  id: string; // TCGPlayer productId (string join key, same space as cards)
  name: string;
  setId: string;
  series: string;
  releaseDate: string; // yyyy-mm-dd or ''
  image: string; // full-size mirrored jpg URL
  imageSmall: string; // 245px webp
  imageMedium: string; // 640px webp
}

export interface SealedSet {
  id: string;
  name: string;
  code: string;
  series: string;
  productCount: number;
}

export interface SealedCatalog {
  products: SealedProduct[];
  sets: Map<string, SealedSet>;
  /** Products newest-first (empty dates last) — the natural carousel order. */
  newestFirst(): SealedProduct[];
}

interface RawSealedProduct {
  id: string | number;
  name?: string;
  set_id?: string | number;
  series?: string;
  release_date?: string;
  image?: string;
  image_small?: string;
  image_medium?: string;
}
interface RawSealed {
  products: Record<string, RawSealedProduct>;
  sets: Record<string, { id: string | number; name?: string; code?: string; series?: string; product_count?: number }>;
}

class LocalSealed implements SealedCatalog {
  readonly products: SealedProduct[] = [];
  readonly sets = new Map<string, SealedSet>();
  private sorted: SealedProduct[] | null = null;

  constructor(raw: RawSealed) {
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

  newestFirst(): SealedProduct[] {
    if (!this.sorted) {
      this.sorted = [...this.products].sort(
        (a, b) =>
          (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.name.localeCompare(b.name),
      );
    }
    return this.sorted;
  }
}

let sealedPromise: Promise<SealedCatalog> | null = null;
let sealedLoaded: SealedCatalog | null = null;
let sealedPricesPromise: Promise<Record<string, number>> | null = null;
let sealedPricesLoaded: Record<string, number> | null = null;

/** Load-once sealed catalog (browse/sealed.json). */
export function loadSealed(): Promise<SealedCatalog> {
  if (!sealedPromise) {
    sealedPromise = fetch(`${getBrowseUrl()}/sealed.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`sealed.json ${res.status}`);
        sealedLoaded = new LocalSealed((await res.json()) as RawSealed);
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
export function loadSealedPrices(): Promise<Record<string, number>> {
  if (!sealedPricesPromise) {
    sealedPricesPromise = fetch(`${getBrowseUrl()}/prices-summary-sealed.json`)
      .then(async (res) => {
        if (!res.ok) return {};
        const raw = (await res.json()) as Record<string, { cur?: number | null }>;
        const out: Record<string, number> = {};
        for (const [id, v] of Object.entries(raw)) out[id] = Number(v?.cur) || 0;
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
export function useSealed(): { sealed: SealedCatalog | null; priceOf: (id: string) => number } {
  const [sealed, setSealed] = useState<SealedCatalog | null>(sealedLoaded);
  const [prices, setPrices] = useState<Record<string, number>>(sealedPricesLoaded ?? {});
  useEffect(() => {
    let cancelled = false;
    loadSealed().then(
      (s) => !cancelled && setSealed(s),
      () => {},
    );
    loadSealedPrices().then((p) => !cancelled && setPrices(p));
    return () => {
      cancelled = true;
    };
  }, []);
  return { sealed, priceOf: (id) => prices[id] ?? 0 };
}
