# 0033 — OpenFeature contract over the D1 flag engine (not the vendor SDK)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§33 of the convergence include-list calls for OpenFeature. ProjectSites already
owns a complete, production feature-flag engine in `modules/feature_flags`:

- D1 `flag_overrides` (tenant / org / global scope) + a typed `FLAG_REGISTRY`
- KV 60s cache, stable rollout-percent hashing (SHA-1 bucket), killswitch stage
- Admin UI (`/admin/feature-flags`), audit log, resolution engine (`isFlagOn`,
  `resolveFlag`), and a two-layer System-Admin / owner-facing plane

Adopting the OpenFeature **vendor SDK** (`@openfeature/server-sdk`) would add a
runtime dependency and a second evaluation path over the same data — duplicated
architecture the include-list protocol explicitly forbids.

## Decision

Expose the existing engine through the OpenFeature **provider contract** — the
standard `ResolutionDetails<T>` evaluation shape (`value` + `reason` + `variant?`
+ `errorCode?` + `flagMetadata?`) — implemented as a thin in-house port, with no
external SDK:

- `platform/feature-evaluation.ts` — the port: `FeatureEvaluationProvider`
  interface, Zod `EvaluationContextSchema` (OpenFeature `targetingKey` + scope
  fields), and `FakeFeatureEvaluationProvider` for tests/local.
- `middleware/feature-evaluation.ts` — `D1FlagEvaluationProvider` wrapping
  `isFlagOn`, plus `getFeatureEvaluationProvider(env)`.

The D1 store remains the single source of truth. App code that wants the
vendor-neutral evaluation API (reason/metadata, not just a bare boolean) calls
the provider; everything else keeps using `isFlagOn` directly.

## Consequences

- **Positive:** standard OpenFeature evaluation surface (portable call sites,
  structured evaluation details) with zero new deps, Workers-native, no second
  flag store. A future REMOTE OpenFeature provider can slot into the factory
  behind an env var without touching call sites.
- **Positive:** fail-soft by construction — a KV/D1 fault returns the caller
  default with `reason: 'ERROR'`; unknown flags fail-closed to `false` (engine
  behavior, unchanged).
- **Negative:** not the literal OpenFeature SDK, so a drop-in OpenFeature
  *client* (hooks, event bus, multi-provider) isn't available — if that ecosystem
  tooling is ever needed, the port can be re-backed by the real SDK.
- **Neutral:** no env secret (wraps our own engine → always available, no gate).
  Ships dark in the sense that no handler calls it yet; wiring is additive.

## Alternatives considered

- **Adopt `@openfeature/server-sdk` + a custom provider** — rejected: adds a dep
  and a parallel evaluation path over the same D1 data for no behavior gain on a
  single-backend system. The contract is the value; the SDK is not.
- **Do nothing (keep only `isFlagOn`)** — rejected: leaves §33 unaddressed and
  forgoes the standard evaluation-details shape that makes call sites portable.
