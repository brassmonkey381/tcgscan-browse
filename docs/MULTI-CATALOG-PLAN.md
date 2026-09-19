# Multi-catalog plan: every game a peer

Status: **plan, nothing built.** Written 2026-09-18, from a survey of the kit and both apps plus an
adversarial review of three independent designs.

> **Superseded on staging and cost by [SLIM-CATALOG-PLAN.md](./SLIM-CATALOG-PLAN.md).** That
> investigation found the peers are already slim (a 9-field whitelist) while Pokémon has no slim
> tier at all, and cut the cross-game work to ~5 days. The *landmines* below still stand and are
> cited from there.

## Why

The kit was built when there was one game. A second arrived in September 2026 (One Piece), a third
a week later (Disney Lorcana), and each one broke something that was *singular*: one catalog
variable, one colour index, one "other" source. Every fix made one subsystem N-shaped. Two now are;
the rest is not.

The owner's ask: **every game is a peer catalog, several loadable at once, so operations can span
them** — cross-game colour search, cross-game similarity, mixed binders that behave like one binder.

The words go too. There is no "primary", no "secondary", no "other".

## What is already N-shaped (copy these, do not invent a third idiom)

| Subsystem | Shape | Where |
|---|---|---|
| Image manifests | `registerImageManifest({key, browseUrl, cacheKey})` into a `Map`, consulted in order, lazily fetched | `src/images.ts:153-219` |
| Colour indices | Keyed by colour URL; `loadColorIndex(url?)` / `getColorIndex(url?)` take a per-call override | `src/color.ts:278-330`, `src/config.ts:257` |

Both are: a registry keyed by a string, lazily loaded, failing soft, with a revision counter React
subscribes to. A catalog registry should look the same.

`setColorUrl` (`config.ts:257`) is a **mode switch and should not be copied** — it mutates a global
for the duration of an async call. It exists because the per-call override arrived later. Delete it
once catalogs are keyed.

## The blockers, with citations

1. **`config` is one set of origins.** `configureBrowse` (`config.ts:182-197`) overwrites every
   field wholesale, and its own doc says call it once. Its sibling `let` singletons — `catalogSource`,
   `languageStore`, `savedSearchStore`, `themedSearch`, `productLine` — mean "switch games by
   reconfiguring" resets things that belong to the host, not the game.
2. **Ambient resolution everywhere.** `getBrowseUrl()` / `getApiUrl()` / `getColorUrl()` are called
   with no argument at ~25 sites (search, similar, prices, color, sealed, catalog, taxonomy,
   images). Every network call targets whichever game was configured last. The answers are wrong,
   not absent.
3. **One catalog per process.** `catalog.ts:654-656` holds `cache` / `loaded` / `subscribers` as
   module `let`s. The first game to call `loadCatalog()` pins the singleton for the session.
4. **`browseState` is one browse session** (`state.ts:40-50`), holding game-scoped values with no
   game tag. This is load-bearing, not incidental — but see Stage 2: it is *already* a live bug with
   one game.
5. **Pokémon is the baked-in default for outbound links.** `POKEMON_LINE` + `productLine` merge
   (`config.ts:169-195`) and `setShopUrl`'s `pokemon &&` branch (`config.ts:346-347`). One global
   outbound identity for a grid that may mix games.

## Measured facts

Sizes verified on published artifacts; heap replayed in node/V8 against `LocalCatalog.hydrate`'s
exact structure. **Nothing has been measured on a device** — that is Stage 0.

| | Cards | Catalog | Built heap |
|---|---|---|---|
| Pokémon EN+JP | 58,884 | 21.9 MB compact (~1.3–1.6 MB on the wire) | ~29 MB |
| One Piece | 7,140 | 1.62 MB | ~4.8 MB |
| Lorcana | 3,484 | 0.83 MB | ~1.9 MB |

**All three resident together ≈ 36 MB, which is fine and is not the problem.** The problem is the
transient: the streaming path holds the decoded `text`, the parsed `raw` and the built catalog alive
at once, so Pokémon alone peaks near 70–80 MB. Every design added a fan-out warm that can stack two
of those peaks. None serialized them.

Cold start: Pokémon is cached on device (`catalogSource.ts:156-181`, 24h TTL); **peers have no cache
at any layer**, so adding two small peers roughly doubles the JSON work of a warm-cache cold start.

## Landmines

These are not design opinions. They are things that will fail *quietly* if the plan ignores them.

1. **`loadCatalogFrom(base)` ignores `base`** whenever a global `catalogSource` is installed
   (`catalog.ts:574-586`). A keyed loader built naively on top of it hands every peer key Pokémon's
   gated catalog *under the peer's name*. CI passes; production shows Pokémon cards under a One
   Piece label.
2. **`browse/catalog.json` does not exist for Pokémon.** It is deleted on every publish
   (`to_supabase.py:1645`, retired 2026-07-12); Pokémon ships as `browse-private/catalog.enc`. Any
   `CatalogDef.url` documented as "the root holding catalog.json" is never true for the primary.
3. **Colour crops are per-game.** `colors.py GEOMETRY`: Pokémon's art window is ~34% of the card and
   excludes the text box; One Piece's is ~52% and includes it. The *encoding* is identical, so the
   arithmetic merges — but the inputs are not comparable, so a merged ranking is plausible and
   systematically biased. No CI check catches this.
4. **Pokémon-JP palettes live at `browse/color-jp`**, unreachable from the `${browseUrl}/color`
   convention. "Colour search across every game" silently covers 28,636 of Pokémon's 58,884 cards.
5. **Peer server tables exist and are deliberately ungranted** (migrations 68/72/73/74: RLS on, zero
   policies). N is 5 in the database — Riftbound and Digimon too — and opening them is its own
   deliberate migration.
6. **The kit resolves art and prices inside its own components.** `RecentProducts` alone has 12
   ambient resolutions; `CardActionModal` and `SealedBrowser` have more. A host cannot wrap around
   them. Fix `CatalogBrowser` only and a mixed surface gets correct tiles and wrong everything else.
7. **Peers publish their game axis into the Pokémon-shaped `types` field on purpose**
   (`onepiece_browse.py` colours, `lorcana_browse.py` inks). A facet descriptor sourced from
   `browse_kit.py` (which says `colors` / `inks`) blanks the Type facet instead of erroring.

### The one-way door

Namespaced `seriesId` / `setId` written into `savedSearches` (`savedSearches.ts:14-63`) or the
`?browse=` payload (`CatalogBrowser.tsx:362-390`) is **persisted user data**. Roll the kit back and
every affected saved search silently returns nothing. Write namespaced refs to a *new* field, keep
writing the bare one, and stop only after a release you are certain you will not roll back.

## The staging

Each stage leaves both apps working and is releasable alone.

**Stage 0 — measure, then make loads safe. (½ day)**
Resident heap per catalog on a real mid-range phone, peak during a load, what AsyncStorage holds per
launch. Then serialize catalog loads (one at a time, ever) and release `text` and `raw` before
`LocalCatalog.build` returns. Everything downstream is a guess without this.

**Stage 1 — `catalogs.ts` beside the globals. (1 day)**
A registry whose primary row *delegates* into today's `loadCatalog` / `getLoadedCatalog`, so
`catalog.ts` takes a zero-line diff. The loader resolves `source` per key and must never route a
peer through `loadCatalogFrom` (landmine 1). Registering the same `browseUrl` twice is an error.

**Stage 2 — per-surface browse state. (1–2 days)**
`browseState` gains an optional `stateKey` (default `'default'`) and commands become addressed
rather than broadcast. **This fixes a live bug with one game** — tcgscan-app mounts three
`CatalogBrowser`s that corrupt each other's query and sort — and it is the precondition for any
cross-game result set having a correct place to land. Optional prop, not required, so the two apps
can move independently (they sit on different kit shas by design).

**Stage 3 — images as one map, plus a catalog-bytes cache. (1 day)**
No privileged row, kit-owned cache key, per-catalog readiness in `cardThumbUrl` (without it, a
registered-but-unloaded peer paints dead URLs). Add the thing no design had: a kit-owned per-catalog
cache for *catalog bytes*, so peers stop re-downloading and re-parsing every launch.

**Stage 4 — hosts register everything and delete their own registries. (2 days, two releases)**
michi first, tcgscan-app one release later. tcgscan-app gets import-time `typeof fn === 'function'`
guards and its own kit-integrity check **before** its sha moves — it has neither today, and it ships
native.

**Stage 5 — per-id resolution that never drops. (1 day)**
Only after `fetchCardsByIds` takes a catalog, and only with a negative cache plus cooldown. Without
both, this trades a silent drop for a render-path request storm against a rate-limited RPC.

**Stage 6 — colour scope and `searchByColorsAcross`. (1–2 days)**
Gated on two prerequisites: a decision on `pokemon-ja` (landmine 4), and a measured mixed query
proving crop geometry does not dominate the ranking (landmine 3). **If it does, ship per-catalog
colour lists side by side rather than one merged list** — an honest partial beats a plausible wrong
order.

**Stage 7 — `catalogs[]` in the browser, behind `?multi-tcg`, picker first. (2 days)**
Includes `RecentProducts`, `CardActionModal` and `SealedBrowser` (landmine 6).

**Stage 8 — grammar and language. (1–2 days)**
Facet descriptors sourced from the kit-facing publishers, never from `browse_kit.py` (landmine 7),
with Pokémon's written explicitly.

## Open decisions

1. **`pokemon-ja` colour**: republish JP palettes under the per-game convention, or accept that
   cross-game colour omits half of Pokémon and say so in the UI?
2. **Merged vs side-by-side colour results**, pending the geometry measurement.
3. **Riftbound and Digimon**: they have tables and a second publish path with different field names.
   Does "adding a game is a publish" have to reconcile both paths, or is the second retired?
4. **Do peers get PostgREST?** Their tables exist, ungranted. Static-only keeps the design simpler
   and is what One Piece and Lorcana do today.

## Provenance

Survey and designs produced 2026-09-18 by nine agents reading the three repos: five surveying (kit
core, kit browser, the two N-shaped precedents, michi, tcgscan-app + blast radius), three proposing
independently (minimal blast radius / clean architecture / risk-first), one adversarial critic. The
staging above is the critic's synthesis, not any single proposal. Heap figures are simulated in
node/V8, not measured on a device — hence Stage 0.
