# Re-spec: jumbo (oversized) + V-UNION handling

Status: **DONE** — both recommendations shipped: the kit derives `kind` from the
per-card `jumbo` flag (`RawCard.jumbo`, legacy `kind` fallback), and the pipeline emits
`vunionGroups` into the catalog, which `vunionGroups()` consumes for the assembled 2×2
group tiles. Kept as the data-model reference. · Owner repos: `tcgscan-browse` (kit read)
+ `tcgscan-data` (what the catalog emits) · Consumers: `poke-michi`, `tcgscan-expo`

Re-spec'd 2026-07-08 against the **live** `catalog.json`
(`…supabase.co/storage/v1/object/public/browse/catalog.json`, 28,176 cards), because
the catalog was normalized/slimmed since the original note and the metadata changed.

## What the live catalog actually has now

A slim card is exactly these 11 fields (set name / series moved to the `sets` map, joined
by `set_id`):

```json
{ "id","name","number","rarity","card_type","set_id",
  "release_date","types","stage","illustrator","jumbo" }
```

- **`jumbo: bool` is published on every card** — 334 are `true`. Derived by the pipeline
  (`catalog/build.py::_is_jumbo`) as `set_name == "jumbo cards"`: TCGPlayer lumps every
  oversized promo into one synthetic **"Jumbo Cards"** set (`set_id 1528`). All 334 carry
  TCGPlayer's baked-in "OVERSIZE" watermark on their image.
- **There is no `kind` field** — and never was in the slim catalog.
- **`subtypes` is NOT in the slim catalog** — it exists on the PostgREST `cards` table
  (for dynamic queries) but was trimmed from `catalog.json`. "V-UNION" lived in `subtypes`.
- **No `vunionGroups`** key in `catalog.json`.

### Two bugs this explains

1. **`listJumbo()` returns empty.** The kit does `normalizeKind(raw_c.kind)`, but `kind`
   is never published, so every card normalizes to `'standard'` and the jumbo list is
   empty — even though 334 cards are cleanly flagged `jumbo: true`.
2. **Typing "JUMBO" returns 200+ hits.** Not a per-card signal — it's a **set-name match**.
   All 334 jumbo cards sit in the one "Jumbo Cards" set, so the grammar's bare-word search
   hits `card.setName` for every one of them. Working as designed; just surprising.

## JUMBO — clean fix, do it now (high confidence)

The metadata the "better metadata?" hunch hoped for already exists: `jumbo: bool`.

- **Kit change:** add `jumbo?: boolean` to `RawCard`; derive `kind` from it —
  `kind = raw_c.jumbo ? 'jumbo' : normalizeKind(raw_c.kind)` (keep the old `kind` read as a
  fallback so a pre-slim catalog still works). `listJumbo()` then returns the 334 oversized
  cards and binder UIs can give them the 2×2 oversized footprint.
- **Known data quirk (surface in UI, don't "fix"):** every oversized card browses under the
  single synthetic **"Jumbo Cards"** set, not its real set, and its `number` / `release_date`
  are that set's. That's how TCGPlayer models them. Fine to ship; just know jumbos cluster in
  one set rather than distributing.
- The "OVERSIZE" graphic is in TCGPlayer's source image and rides through our mirror. Nothing
  to do unless we ever want to crop it.

## V-UNION — needs a datasource decision (no clean signal in the slim catalog)

With `subtypes` and `vunionGroups` both absent, the **only** V-UNION signal in `catalog.json`
today is the card **name**. The pieces are reconstructable but messy. Today's data (5 bases;
Morpeko printed twice → 6 groups):

| base | quarter pieces (collector #, in tiling order) | also present |
|---|---|---|
| Greninja | SWSH155–158 | `[Set of 4]` bundle · a `jumbo` single |
| Mewtwo | SWSH159–162 | bundle · jumbo single |
| Zacian | SWSH163–166 | bundle · jumbo single |
| Pikachu | SWSH139–142 | bundle · jumbo single |
| Morpeko (1) | SWSH215–218 | bundle · jumbo single |
| Morpeko (2) | SWSH287–290 | bundle · jumbo single |

So a group = the four consecutive-numbered singles under `"<base> V-Union"` — **excluding**
the `[Set of 4]` bundle (no number) and the `jumbo` single. Ordering by collector number gives
the 2×2 tiling order (TL, TR, BL, BR).

**Why the kit shouldn't reconstruct this itself:** name casing is inconsistent
(`V-UNION` vs `V-Union`), a base can have multiple printings, and the whole thing leans on a
number-order assumption. Per `ARCHITECTURE.md`, data-shape truth belongs to the datasource
seam, not scattered heuristics in the kit.

### Options

1. **Pipeline emits it (recommended).** `tcgscan-data` already has `subtypes` + numbers, so
   have `build.py` emit a `vunionGroups` array into `catalog.json` — `{ base, label, pieces:
   [id,id,id,id] }` in tiling order — the single source of truth. The kit already has
   `RawVUnionGroup` / `vunionGroups()` wired to consume exactly this (it validates the 4 ids
   resolve); it returns empty today only because the key is absent.
2. **Per-card `vunion: bool`** (mirror `jumbo`), and let the kit group by base name + number.
   Cheaper pipeline change, but pushes the fragile grouping into the kit.
3. **Drop the 2×2 assembly.** Treat quarter pieces as ordinary 1×1 cards; optionally show a
   "V-UNION" badge. Simplest; loses the "assemble the four quarters" binder feature.

### Recommendation

- **JUMBO:** fix in the kit now (read `jumbo`). Tiny, high-value, unblocks `listJumbo()`.
- **V-UNION:** go with **option 1** — pipeline emits `vunionGroups`. Until it does, V-UNION
  pieces render as standard 1×1 cards (no crash — `vunionGroups()` just stays empty). Don't
  build the name/number heuristic into the kit.

## Checklist

- [x] Kit: `RawCard.jumbo?: boolean`; `normalizeKind`/build derives `kind` from `jumbo`
      (fallback to `kind`). Verify `listJumbo()` → 334.
- [x] Pipeline: emit `vunionGroups` (base, label, ordered `pieces`) into `catalog.json`,
      excluding `[Set of 4]` bundles and jumbo singles.
- [x] Kit: confirm `vunionGroups()` populates once the key is present (already wired).
- [ ] Keep the [[server-search-rollout]] note in mind — `subtypes` is available server-side
      if we later want richer V-UNION / oversized filtering via the RPC.
