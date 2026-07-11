# Plan: protecting the catalog while keeping offline + a no-signup trial

Status: **P1 (kit seam, v0.5.17) + P3 (encrypt + gate, 2026-07-11) SHIPPED · P2 (watermark)
parked** · Repos: `tcgscan-browse` (kit seam), `tcgscan-data` (catalog.enc + catalog_keys +
the `catalog-key` edge function — note the CROSS-PROJECT JWT validation: app sessions live on
the app project, so the function verifies the app JWT itself), `poke-michi`
(`src/lib/catalogSource.ts`, gated with public fallback).
Remaining protective flip: retire the public catalog.json + set REQUIRE_REGISTERED (edge fn
const) + an encrypted-at-rest offline cache + a native gated path.

## Goal & honest threat model

`catalog.json` is a valuable curated dataset we still want to ship **client-side for offline
use**. Offline means the full data lives on-device, decryptable by the app — so a determined
reverse-engineer can always extract it. **We are not trying to make that impossible.** We are:

1. removing the trivial theft (today it's a **public bucket URL — one `curl`, no app**),
2. raising the effort for casual copying above the value, and
3. making *commercial* copying **detectable and legally risky** (watermarking + ToS).

What's already safe and should stay server-only: the **64-d embeddings** and the **scan-match
model** (the real moat). Most raw fields (names/numbers/sets/hp/evolution) are re-derivable from
public sources — the defensible value is our **curation** (dedup canonicals, clean-image policy,
V-UNION grouping, art matching) + the effort we saved.

## The tiering model (resolves "trial vs. protect")

Don't hand the valuable file to unauthenticated users at all — give them the **online**
experience instead of the **offline dataset**:

| Tier | What they get | Data exposure |
|------|---------------|---------------|
| **Anonymous / trial** | Online **server search** only (the `search_cards` RPC). Full browse/search to evaluate. | Catalog never leaves the server. Rate-limited, capped. |
| **Signed-up** | The full catalog for **offline** — gated, short-lived-key-encrypted, watermarked. | The copyable asset, but only to a real (traceable, rate-limitable) account. |

This falls out of the **cold/warm split already built**: for anonymous users the app simply
**doesn't load the catalog** → the kit stays on the cold/server-search path (`catalog={null}` →
☁ mode). For signed-up users the app loads the (gated, encrypted) catalog → warm/offline. So
"trial without exposing data" is a per-user decision in the *app*, not a kit rewrite. "Offline
mode" becomes a reason to sign up — good product design, too.

> If you later want anon users to have offline as well, the lever isn't auth (an anon token the
> app mints, a scraper mints too) — it's making **token issuance costly**: Cloudflare Turnstile /
> a CAPTCHA / mobile attestation in front of anonymous sign-in, + per-IP rate limits. Out of scope
> for P1.

## Component responsibilities

- **Kit (`tcgscan-browse`)** — stays auth/crypto-agnostic. Adds ONE seam: an injectable
  **`catalogSource`** so the app supplies the catalog (already fetched + decrypted + decoded)
  instead of the kit fetching the public URL. Default (no source) = today's public fetch
  (back-compat for `tcgscan-app` and trial builds). Server search path unchanged.
- **App** — owns auth. Decides the tier: anon → don't load the catalog (cold/server search);
  signed-up → provide `catalogSource` that (1) gets a short-lived key from an authed endpoint,
  (2) fetches the encrypted catalog (signed URL / authed), (3) decrypts + decodes to `RawCatalog`,
  (4) caches it **encrypted-at-rest** for offline. Reports progress for the load bar.
- **Pipeline (`tcgscan-data`)** — produces the **encrypted + watermarked** catalog into a
  **private** bucket, and (edge function) serves the **short-lived decryption key** to authed
  sessions. Keeps publishing the public catalog during migration / for trial-less consumers.

## The kit seam (P1 — building now)

`configureBrowse({ catalogSource })`, where:

```ts
export type CatalogSource = (
  onProgress?: (received: number, total: number) => void,
) => Promise<RawCatalog>;
```

- When set, `loadCatalog()` calls it instead of fetching `catalog.json`; the returned `RawCatalog`
  goes through the same chunked (non-blocking) build, and `onProgress` drives the download portion
  of the load bar.
- When omitted, the kit fetches the public bucket exactly as today (streaming progress).
- Additive, back-compat, no behavior change until an app opts in. This is the single integration
  point for every protection below.

## Encryption & key flow (P3)

- **At rest:** publish `catalog.enc` (AES-256-GCM) to a **private** bucket instead of (or beside)
  the public `catalog.json`. The bytes are useless without the key.
- **Key delivery:** a Supabase **edge function** `catalog-key` returns the current key **only to a
  valid session** (anon or real — gate to real if trial stays server-only), short-TTL, rotated per
  publish. The key never ships in the app bundle (a static embedded key is trivially extracted).
- **Client:** `catalogSource` calls `catalog-key` (authed) → fetches `catalog.enc` (signed URL) →
  AES-GCM decrypt (Web Crypto on web; `expo-crypto`/polyfill on native) → decode → `RawCatalog`.
- **Offline:** cache the **encrypted** blob + require a key fetch on cold start when online; when
  offline, fall back to a locally-wrapped copy (key sealed with a device secret). Never persist
  plaintext JSON to disk.
- Rotating the key per publish means a leaked key expires at the next publish.

## Watermarking (P2 — the anti-"they built a DB from ours" lever)

In the publish pipeline, before encrypting:
- **Canary traps:** a handful of invisible fingerprints — fabricated/subtly-perturbed entries, a
  deterministic record ordering, or low-order field tweaks unique to our build. If a competitor's
  DB carries our canaries, that's **proof of copying** (deterrence + legal path).
- **Per-user (when downloads are gated):** stamp each delivered copy with a per-account marker so a
  leak traces to an account. Needs per-request generation — do it in the key/serve edge function or
  a light transform, not the static bucket object.
- Keep a private registry of canaries so we can test a suspect dataset.

## Gating (P3)

- Make the `browse` bucket (or a new `browse-private`) **private**; serve `catalog.enc` via
  **signed URLs** minted by the authed key/serve edge function, or stream it from the function.
- Public `catalog.json` stays only for back-compat consumers during migration; retire it once apps
  move to the gated path (or keep a **reduced** public subset for trial's non-search needs).
- `cards` table / `cards_search` / `search_cards` remain anon-readable **only** as needed for the
  trial server-search tier — capped + rate-limited (see SERVER-SEARCH-PLAN "rate-limit").

## Fallback / back-compat

- No `catalogSource` → public fetch (unchanged). `tcgscan-app` and any trial build keep working.
- If the key endpoint / decrypt fails, the app can fall back to **server search** (cold path) so
  the user isn't hard-blocked — degrade to online, don't break.

## Phasing

- **P1 (now):** kit `catalogSource` seam (additive, back-compat). Unblocks everything else.
- **P2:** watermark + canaries in the publish pipeline (cheap, high deterrence value); private
  canary registry.
- **P3:** encrypt the catalog to a private bucket + `catalog-key` edge function (short-TTL,
  per-publish rotation) + app wiring (tier by auth, decrypt, encrypted-at-rest cache).
- **P4 (optional):** attestation (Turnstile/CAPTCHA) + rate-limit on anonymous token issuance if
  anon users are ever given offline; per-user watermarking on the gated download.

## Reality check

None of this stops a skilled reverse-engineer holding the offline app — they can hook the runtime
and dump the decrypted data. The combination makes **casual** copying annoying (P1/P3 kill the easy
paths) and **commercial** copying **detectable + legally dangerous** (P2/ToS). That's a realistic,
defensible posture for a valuable-but-shipped dataset — and the trial tier means unauthenticated
scrapers never touch the file at all.
