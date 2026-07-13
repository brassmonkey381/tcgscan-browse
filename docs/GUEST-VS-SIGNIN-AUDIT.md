# Audit: guest vs signed-in experience (michi-maker)

Audited 2026-07-12 against kit **v0.5.24**, poke-michi `main`, live data server.
Context: the public `catalog.json` is retired; the full catalog is a signed-in perk
(`REQUIRE_REGISTERED = true` in the `catalog-key` edge function). Guests run the
cold path: server search + public taxonomy + per-set fetches.

## Tier architecture (one paragraph)

Guests (anonymous app session) never request the catalog (`useCatalog` tier gate) — the
browser runs cold: `search_cards`/`search_facets` RPCs, the 84 KB public `taxonomy.json`
drill-down, per-set card fetches, and id-resolved images. Signed-in users additionally load
the gated encrypted catalog (0.8 MB) → warm mode: on-device search, plus the catalog-dependent
extras. Everything else (binders, images, prices, sealed) is tier-independent.

## At parity (verified)

| Area | Notes |
|---|---|
| Home first paint | Binder covers (id-resolved), Sealed Products carousel, no big downloads — both tiers |
| Search | Same grammar, same results/order (server RPC at exact parity, validated 7/7), facets, sort, infinite scroll |
| Drill-down | Series → Set → Card both tiers (cold: taxonomy + per-set fetch; facets/sort work on drilled sets) |
| Card sheet | Facts, value, evolves-from/to, View set, View artist — cold rows carry all fields |
| Similarity | Find similar / similar-to-all / More-Less like this (Rocchio sessions) — cold resolves hits via `fetchCardsByIds` |
| Multi-select | Ctrl/Shift + toggle mode, batch add — both tiers |
| Prices | Public `prices-summary*.json` serves both tiers |
| Binders | Create/edit/persist (guests have an anonymous cloud session; upgrade keeps binders) |
| Artwork tab / playground | Catalog-free |

## Intentional tier perks (properly messaged)

| Feature | Guest | Signed-in | Messaging |
|---|---|---|---|
| Full offline/on-device catalog (⚡ instant, zero-latency refinement) | ☁ server search | ✓ | Badge shows "☁ Server search — instant" (no false "loading…") |
| Auto-fill composer (scans full catalog) | ✗ | ✓ | `SignInPerk` note ✓ |
| Card labels / captions in binders | blank | ✓ | `CaptionControls` sign-in note ✓; BinderGrid just omits them |
| HomeRecent rich feed (set montages + card strips) | HomeSets tile strip (lighter) | ✓ | Silent swap — acceptable |
| V-UNION assembled group tiles (Size facet) | ✗ (facet value absent) | ✓ | Silently absent — acceptable (needs `vunionGroups`) |
| Analytics (kit) | ✗ warm-only | ✓ | michi doesn't surface browse analytics today — moot |

## Gaps that are BUGS / unhandled (actionable)

1. **SliceStudio card picker: infinite spinner for guests.** `SliceStudio.tsx` renders
   `catalog ? <CardBrowse/> : <ActivityIndicator/>` — the guest catalog never arrives, so the
   spinner never resolves. Fix: render `<CardBrowse catalog={catalog}>` unconditionally (cold
   browse works; CardPicker already does this). *One-line fix, highest priority.*
2. **Jumbo / V-UNION placement footprint degrades for guests.** `BinderScreen` derives the
   drop footprint via `footprintForKind(resolveCard(cardId)?.kind)` and `resolveCard` is
   catalog-only → guests placing a jumbo from cold browse get a 1×1 pocket (should be 2×2).
   Same for BinderGrid's oversized-render `kind`. Cold cards DO carry `kind` (rows include
   `jumbo`) — fix by threading the picked card's kind through `onPickCard`, or a small cold
   card-id → kind cache fed by `fetchCardsByIds`.
3. **"≈ Find similar to ‹pocket card›" shortcut hidden for guests.** `occupant` resolves via
   the catalog only, although the similarity RPC itself works cold. Fix: resolve the occupant
   via `fetchCardsByIds` (or accept a `{id,name}` prop from the app).
4. **Cold similar-source thumbnails half-work.** The strip renders (image is id-derived) but
   tapping a source card is a no-op unless it happens to be in the current view (`findCard`
   falls back to `viewCards`). Cosmetic.
5. **`similar`/`viewSet` browse commands (by cardId) are no-ops cold** (`catalog?.getCard`).
   Mostly moot — their sender (HomeRecent) is signed-in-only, and HomeSets uses the cold-safe
   `viewSetById` — but worth a `fetchCardsByIds` fallback for robustness.

## Platform caveats

- **Native (iOS/Android) signed-in users get GUEST-level browse.** React Native lacks
  `crypto.subtle` + `DecompressionStream`, so the gated path is web-only; the public fallback
  now 404s (file retired) → native signed-in = cold mode + one wasted request. Web is the
  primary domain today, but this must be fixed (crypto polyfill / native AES) before any
  native push. Badge degrades gracefully ("☁ Server search — instant").
- **tcgscan-expo is fully broken** (still reads the retired public catalog). Accepted;
  migrate to `catalogSource` / cold mode when it matters.

## Adjacent open items (affect both tiers equally)

- **No persistent offline cache**: signed-in "offline" is in-memory per session — a refresh
  without network loses the catalog. The planned encrypted-at-rest cache is unbuilt.
- **Rate limiting is per-IP for BOTH tiers**: the kit calls the search RPCs with the bare
  data-project anon key (no user JWT — cross-project sessions), so `rl_check` keys on IP.
  Shared-IP users (NAT) share a bucket; signed-in users get no personal allowance.
- **PostgREST `cards` table remains anon-readable wholesale** (bulk pagination bypasses
  `rl_check`, which only guards the RPCs) — a data-protection residual, not a UX gap. Closing
  it means revoking anon `select` and forcing all reads through rate-limited RPCs (must first
  move `fetchSetCards`/`fetchCardsByIds` to RPCs too).

## Recommendations (priority order)

1. Fix the SliceStudio guest spinner (one line).
2. Fix cold jumbo/V-UNION placement footprint (thread `kind` through the pick path).
3. Cold-resolve the pocket-similar occupant + command/thumb lookups via `fetchCardsByIds`.
4. Add a gentle sign-in nudge to the ☁ badge ("sign in for offline + instant search") — the
   perk is currently invisible at the point of use.
5. Before any native release: native gated-catalog path (AES polyfill) — else signed-in
   native users silently lose their perk.
6. When hardening further: per-user rate limits (forward the app JWT to an edge-validated
   search proxy) and close the PostgREST bulk-read hole.
