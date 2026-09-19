# Slim catalogs and cross-game search

Status: **plan, nothing built.** Written 2026-09-18. Companion to `MULTI-CATALOG-PLAN.md`, which
this supersedes on staging and cost.

## The premise inverts

The idea was "use a slim catalog, like Pokémon's warm-start". Investigating it turned up the
opposite of what we assumed:

- **There is no slim Pokémon catalog.** "Slim" is a field-drop applied in place inside the single
  encrypted artifact `browse-private/catalog.enc` (`to_supabase.py:1388`, applied `:1618-1620`).
  There is no second, smaller object for anything to reuse.
- **The peers are already slim.** One Piece and Lorcana build each card from a **9-field
  whitelist** (`onepiece_browse.py:247-258`, `lorcana_browse.py:306`), not a drop-list. They are
  already what "slim" was meant to produce.
- **The thing with no tier below "whole catalog" is a peer**, not Pokémon. Pokémon can degrade to
  server search when its catalog is absent; a peer cannot, because the peer tables are deliberately
  ungranted (migrations 68/72/73/74: RLS on, zero policies). **That asymmetry — not memory — is the
  real argument for a slim tier.**

So a slim catalog is a *new* artifact tier, and it belongs to the peers first.

## Three things worth doing whatever we decide about cross-game

These are independent wins. They total about two days and none of them needs a design decision.

### 1. Drop four dead fields — 15 minutes, 18.1% of the bundle

`full_art_score`, `print_variant`, `full_art` and `stamp` total **4,132,399 bytes — 18.1%** of
Pokémon's shipped catalog, and **nothing in any of the three repos reads them.** The drop-list's own
comment claims `print_variant` and `stamp` are kept for the alternates panel; that panel moved to
the `card_alternates` RPC (`tcgscan-app/src/lib/alternates.ts:1-22`), so the comment is stale.

Measured: 22,847,161 → 18,714,762 plaintext, 1,652,339 → 1,523,199 gzipped.

`full_art_score` is named in migration 59's own header as proprietary, and it currently ships to
every signed-in free user.

### 2. Fix the negative caches — 1 day, and one of them is leaking today

Three sites pin *hits* but never *misses*:

- `fetchCardDetail` (`search.ts:412-441`) — **`CardActionModal` fires it on every open** where
  `evolutionLine` is empty (`CardActionModal.tsx:58-70`). For a peer id the Pokémon RPC can never
  answer, so every open is a doomed request that is never remembered. Open twenty peer cards and
  reopen them: forty requests that cannot succeed. **This is live now, with no slim work at all.**
- `fetchCardsByIds` (`search.ts:346-352`) — its own comment says misses "simply retry on the next
  call". This is the per-id route any on-demand tier builds on.
- `other-game.ts:225` — the pinning block is gated on the batch resolving *something*, so a batch
  where nothing resolves pins nothing, and `restCards` has no cache at all.

`MULTI-CATALOG-PLAN.md` Stage 5 already says per-id resolution must not ship without these. Worth
shipping on its own.

### 3. Load hygiene — half a day, ~40 MB off the transient peak

Release `text` and `raw` before `LocalCatalog.build` returns (after `writeCache(text)`), and share
one empty array across the three `?? []` sites (`catalog.ts:337-370`).

**Freeze that shared array in dev only.** ES modules are strict mode, so writing to a frozen array
*throws* — loudly, in Hermes, on a render path, in production. That is a white screen, and we have
already had one this month.

## The cross-game work — about 3 days

### 4. Measure on a device first (half a day)

Every heap figure we have is node/V8 on Windows, not Hermes on a phone. `MULTI-CATALOG-PLAN.md`
Stage 0 still has not run, and it gates the one stage below whose justification is a heap number.

### 5. Peers get a resolve tier — published *alongside*, never instead (1 day)

`browse/<game>/catalog-slim.json` carrying `id, name, number, set_id, rarity, jumbo` **plus
`release_date`** (see below). Measured: One Piece 1,624,638 → ~0.85 MB, Lorcana 827,914 → ~0.45 MB.

Two rules that make it safe:

- **Keep publishing each game's full `catalog.json` forever**, and have the app try slim then fall
  back. The slim URL is compiled into a shipped native binary — if the object 404s, every peer card
  reads "Unknown card", and the fix would need a store release rather than a pipeline revert.
- **Do not hand the slim file to michi.** Its picker *browses* peer catalogs, and its fill methods
  read `evolution_line` and `types` (`pageComposer.ts:243-256`).

### 6. Three fields that must stay in every tier

Cutting these looks attractive by size and breaks whole surfaces:

| Field | Why it cannot go |
|---|---|
| `release_date` | The **largest** field (1.63 MB) and the input to set *and* series ordering (`catalog.ts:403-404, 417-427`), the entire Recent & Upcoming feed (`RecentProducts.tsx:245-247`), and michi's `varietyRank` era sampling |
| `evolution_stage_index` | `evolutionNeighbors` needs three fields; `fetchCardDetail` returns two. Drop it and "evolves to" stays blank *even after* the lazy fetch lands |
| `imageSubstituted` | A publish-time flag with **no DB column and no fallback route**. It is the "this image may differ from the real card" caveat (`CardActionModal.tsx:113-118`). Slimming it away silently deletes a data-honesty notice |

With `release_date` kept, Pokémon's resolve tier is ~8.3 MB rather than 6.69 MB — still 64% off.

### 7. The rule neither design stated: **slim must never serve the active game**

`CatalogBrowser` branches on the catalog being non-null (cold `:1127`, warm `:1139`),
`catalog ?? taxonomy` makes the catalog *win* over the published taxonomy (`:824`), and
`RecentProducts` suppresses its server fallback when a catalog exists (`:209-210`).

So for Pokémon **a slim catalog is strictly worse than no catalog**: it switches off a server path
that answers `artist:`, `type:`, `stage:`, `year:` and `theme:`, and shadows a `taxonomy.json` that
already carries precomputed set dates. Slim is a peer tier only.

## What slim does not buy

**On the wire, less than it looks.** Dropping 71% of the plaintext buys 46% of the gzipped bytes:
1.652 → 1.523 → 1.448 → 0.893 MB across the tiers. Holding all three games at the resolve tier is
1.075 MB gzipped, against 1.652 MB for Pokémon alone today — a real win, but not an order of
magnitude.

**In memory, nothing at all.** `hydrate` builds a fixed 23-key `CatalogCard` from whatever it is
given, so 22.85 MB of JSON and 17.53 MB of JSON both produce ~30.5 MB of heap. Slimming the file
does not slim the object; only changing the resident shape would, and that breaks the `CatalogCard`
contract across michi.

## Grammar: what breaks, and the part that is silent

- **The bare-word collapse.** `scoreCard` requires *every* bare word to match somewhere or it
  returns 0 (`query.ts:541-552`), and the haystack includes `illustrator`, `stage`, `types` and
  `cardType`. Drop those and "pikachu basic" does not degrade — it returns **zero rows**, including
  the cards that used to match.
- **`sort:value` and every price bound delete peer cards.** `prices.ts` is a singleton keyed to the
  ambient browse URL (`:22-28`), so `priceOf` returns 0 for peer ids — and `value>=5` then filters
  them all out (`query.ts:559-563`). Prices are *not* N-shaped, unlike images.
- **Saved searches and share links are persisted user data.** A saved chip carrying `{hp:['100+']}`
  against a catalog with no `hp` silently returns nothing. Same class as the one-way door in the
  prior plan.
- **`theme:` is already dead in the bundle** — `SHIP_CAPTIONS_IN_BUNDLE = False` strips every
  caption today, so slimming changes nothing there.

Survives slim intact: `have:`/`owned:`, `sort:name`, `sort:num`, and `rarity:`/`set:`/`series:`/
`num:`/`lang:` — the last three because `setName`, `setCode` and `seriesId` are joined from
`set_id`, so one integer buys all three.

## The owner call: a public slim Pokémon catalog

**Allowed by the letter.** `DATA-PROTECTION-PLAN.md:107` sanctions "a **reduced** public subset",
and migration 59 already grants `anon` SELECT on 19 card columns — which makes the tier table's
"Catalog never leaves the server" line untrue today regardless.

**But the unasked question is enforcement.** The plan says the defensible value is our *curation*,
and its enforcement is traceability: canary traps, and per-account stamping "when downloads are
gated". Neither survives an unauthenticated CDN object — there is no account to stamp, and a
whole-corpus canonical id list is exactly the dedup curation the doc names, handed over in one
request, untraceable.

If it ships: strict subset of the granted columns only, named `browse/catalog-slim.json`
(`browse/catalog.json` is deleted on every publish, twice), and reword `DATA-PROTECTION-PLAN.md:33`
either way.

## Ordering

1. Drop the four dead fields · 15 min
2. Negative caches · 1 day *(fixes a live leak)*
3. Load hygiene · ½ day
4. Device measurement · ½ day
5. Peer resolve tier, published alongside · 1 day
6. Kit reads slim for peers, falls back to full · 1 day
7. *(owner call)* public Pokémon resolve tier · 1 day

**~5 days, of which the first 2 are worth shipping alone.**

Deferred: a slim *resident* shape. It is the only piece whose justification depends on absolute
heap numbers, and it breaks the `CatalogCard` contract across michi.

## Provenance

Six agents, 2026-09-18: three surveying (Pokémon's slim path, field requirements, publish cost),
two designing under opposed lenses (slim-first / hybrid), one adversarial critic that
re-derived every size independently. Byte figures were reconstructed from
`work/catalog.json` + `work/catalog_jp.json` by replaying the publisher's own drop list, and agree
across four independent runs to within 0.05%. **Unverified:** the real published size of
`catalog.enc` (three different figures live in comments; nobody has read the bucket), and all
resident-heap numbers, which are node/V8 rather than Hermes.
