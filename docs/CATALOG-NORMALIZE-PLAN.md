# Plan: normalize the browse catalog (derive URLs, dedup set/series fields)

Status: **in progress** · Owner repos: `tcgscan-data` (producer) + `tcgscan-browse`
(consumer) · Apps: `poke-michi`, `tcgscan-app/tcgscan-expo`

## Why

`catalog.json` is ~26.8 MB raw (the cold-start parse/heap cost). Measured, **~62%
of it is redundant** — no unique card data:

| Class | Fields | Size | Recovered by |
|---|---|---|---|
| Derivable URLs | `image`, `image_small`, `image_medium` | 9.7 MB (36%) | manifest `cardThumbUrl(id, tier)` |
| | `image_cdn` | 2.2 MB (8%) | `cdnImageUrl(id)` — pure `{id}` template |
| | `product_url` | 1.6 MB (6%) | `productUrl(id)` — pure `{id}` template |
| Denormalized set/series | `set_name`, `set_code`, `set_url_name`, `series` | 3.2 MB (12%) | join on `set_id` (100% redundant with the `sets` map) |

Target: **26.8 MB → ~10 MB**, zero data loss, identical in-memory capability —
freeing budget for new per-card fields.

The full flat/denormalized records still exist in the PostgREST `cards` table, so
external consumers that want them query that; `catalog.json` is the lean app bootstrap.

## Kit changes (tcgscan-browse) — make resolution not depend on those fields

1. **Images via the manifest.** The browse tiles + action sheet resolve images with
   `cardThumbUrl(card.id, tier)` (manifest → content-hashed URL) instead of reading
   `card.image*`. `CatalogBrowser` calls `useImageManifest()` to hydrate + repaint.
2. **`cardThumbUrl` fallback fixed.** For cards not in the manifest (the ~1,346 not
   yet mirrored), fall back to the id-derivable CDN URL, not the dead flat
   `card-thumbs/<tier>/<id>.webp` convention path (which 404s on the hosted bucket).
3. **Set/series join.** `LocalCatalog` builds a `setMeta` map from `raw.sets` and
   derives each card's `setName`/`setCode`/`seriesId` from `set_id` — with a
   `raw_c.set_name ?? …` fallback so it reads BOTH the fat (old) and slim (new)
   catalog. In-memory `CatalogCard` is unchanged, so search/facets are unaffected.
4. **Helpers exported:** `productUrl(id)`, `cdnImageUrl(id, size?)`.

## Pipeline changes (tcgscan-data `publish_browse`)

Strip from each published card (keep `set_id`, the join key):
`image, image_small, image_medium, image_cdn, product_url, set_url_name,
set_name, set_code, series`. The `sets` objects keep `name/code/url_name/series`
(the join source); `images.json` is unchanged (the image resolver).

## Rollout ordering (a slim catalog is BREAKING for old kit builds)

The shipped kit reads `card.image*`/`card.set_name` directly, so a slim catalog
blanks images / loses set names on any app build older than the kit update. Order:

1. **Kit** — ship resolution changes (above), `v0.3.5`. Works against the fat catalog.
2. **Apps** — bump to the new kit, fix any direct `card.image`/`product_url` reads,
   rebuild/restart Metro. Now the live app floor resolves images via the manifest.
3. **Pipeline** — publish the slim catalog. Only safe once step 2 is the floor.

Immediately-safe subset (no shipped kit/app reads them) if a phased cut is wanted:
`product_url`, `image_cdn`, `set_url_name` (−18%) can drop before step 2.

## Back-compat

The kit reads fat OR slim catalogs (the `?? set-join` + manifest resolution). Only
the *published payload* changes; no schema/version bump on the consumer contract.
