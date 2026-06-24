# 0047 — Stainless SDK-codegen over the OpenAPI 3.1 spec

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§47 of the convergence include-list calls for Stainless (typed client-SDK
generation from an OpenAPI spec). This is the one targeted item with **no homegrown
equivalent** — ProjectSites does not ship a client SDK today. It does, however,
already produce the input Stainless needs: `routes/docs.ts` serves a generated
**OpenAPI 3.1** document at `GET /api/admin/docs/openapi.json` (built from a
hand-curated route table covering the API surface).

Stainless is a build/CI concern (it generates code from a spec), not a runtime
provider — but modeling it as a port keeps it consistent with the other
integrations (env-gated, fail-soft, ships dark) and gives it unit-test coverage.

## Decision

Build a foundation-first **SDK-codegen port**:

- `platform/sdk-codegen.ts` — `SdkCodegenProvider` (`generate(spec)` →
  `SdkGenerationResult{status,project?,message?}`) + Zod `SdkCodegenConfigSchema`
  + `NoopSdkCodegenProvider` (dark default) + `FakeSdkCodegenProvider`.
- `middleware/sdk-codegen.ts` — `StainlessSdkCodegenProvider` (fetch-based POST of
  the spec, no SDK) + `getSdkCodegenProvider(env)`.
- `types/env.ts` — `STAINLESS_API_KEY` + `STAINLESS_PROJECT`.

The spec source is the existing `/api/admin/docs/openapi.json` — no second spec to
maintain.

## Consequences

- **Positive:** addresses §47 with a real, tested foundation; feeds the existing
  OpenAPI spec; zero new deps; fetch-based (Workers-native). `baseUrl`/endpoint are
  config, so finalizing the exact Stainless REST contract is a config change, not a
  code change.
- **Positive:** ships **dark** — no `STAINLESS_API_KEY` → `NoopSdkCodegenProvider`
  (`generate()` resolves `skipped`, no network). Fail-soft: HTTP-error / thrown →
  `status: 'error'`.
- **Negative:** the exact Stainless API path (`/api/spec`) + auth header shape are
  provisional until a key is provisioned and the contract is confirmed; the adapter
  is `scaffolded`, not `production`, until then.
- **Neutral:** SDK generation isn't wired into CI yet — it's a `gen:sdk` step to add
  once the key exists.

## Alternatives considered

- **Hand-write + maintain a client SDK** — rejected: drifts from the API surface;
  Stainless regenerates from the spec on every change.
- **Use the OpenAPI Generator toolchain instead of Stainless** — deferred: Stainless
  is the include-list choice and produces higher-quality idiomatic SDKs; the port
  keeps the backend swappable if that changes.
- **Do nothing** — leaves §47 the sole unaddressed targeted item.
