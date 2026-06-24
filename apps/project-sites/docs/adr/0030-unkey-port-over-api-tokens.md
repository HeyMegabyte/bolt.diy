# 0030 — Unkey contract over the D1 api_tokens keystore (don't host Unkey)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§30 of the convergence include-list calls for Unkey (API-key management).
ProjectSites already owns a complete API-key system in `services/api_tokens`:

- `psk_<32-byte-hex>` keys; only the SHA-256 hash is stored in D1 `api_tokens`
- scopes (`sites:read`, `media:write`, …), expiry, revoke, `last_used_at`
  throttling, org ownership, bearer extraction, scope checks
- already the live auth path for the public API at the edge

Two ways to "add Unkey" were considered. Hosting Unkey on CF Workers is not
viable — Unkey's product is a DB-backed container stack (API + dashboard +
datastore/analytics), not a Worker artifact; and edge key-*verification* (the
hot path) is exactly what `api_tokens` already does Worker-natively.

## Decision

Expose the existing keystore through an **Unkey-style provider contract** — a
thin in-house port, no vendor SDK, no hosting:

- `platform/api-keys.ts` — the port: `ApiKeyProvider` (`createKey` / `verifyKey`
  / `revokeKey`) with a structured `KeyVerificationResult` (`valid` + `code` +
  `keyId` + `ownerId` + `scopes`), plus `FakeApiKeyProvider` for tests/local.
- `middleware/api-keys.ts` — `D1ApiKeyProvider` delegating to
  `createApiToken`/`verifyApiToken`/`revokeApiToken`, plus `getApiKeyProvider(env)`.

`api_tokens` stays the source of truth and the live verification path. Call sites
that want the vendor-neutral key API use the provider; everything else keeps
calling `verifyApiToken` directly.

## Consequences

- **Positive:** Unkey-shaped, vendor-neutral key API (portable call sites,
  structured verification result) with zero new deps, Workers-native, no second
  keystore, no container to host. A managed Unkey adapter can slot into the
  factory behind `UNKEY_ROOT_KEY` later without touching call sites.
- **Positive:** fail-soft — a thrown D1 error in `verifyKey` returns
  `{ valid: false, code: 'NOT_FOUND' }`; the keystore already collapses
  revoked/expired/absent into "no valid row" so existence never leaks.
- **Negative:** not Unkey's *product* features (per-key ratelimit primitives,
  analytics dashboards, key roles/identities). If those are ever needed, wire
  managed Unkey as a `managed-saas` adapter behind this same port.
- **Neutral:** no env secret (wraps our own keystore → always available, no gate).
  Ships dark: nothing calls the port yet; wiring is additive + behavior-neutral.

## Alternatives considered

- **Host Unkey on CF Workers** — rejected: Unkey's self-host is a DB-backed
  container stack, not a Worker; the hot-path verification is already Worker-native
  in `api_tokens`. (See the hosting discussion: managed-SaaS or single-host, never
  CF Workers, for stateful OSS apps.)
- **Adopt managed Unkey now via API** — deferred: `api_tokens` already covers
  create/verify/scope/revoke for the current public API; the managed product's
  extra features aren't needed yet. The port keeps that option open.
- **Do nothing** — rejected: leaves §30 unaddressed and call sites coupled to the
  bare `verifyApiToken` boolean instead of a vendor-neutral contract.
