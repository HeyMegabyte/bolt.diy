# 0003 — Workflow/job routing: Cloudflare Workflows → Inngest → Hatchet Cloud

**Status:** accepted
**Date:** 2026-06-20
**Deciders:** Brian Zalewski

## Context

ProjectSites runs many classes of async work — claim flows, billing lifecycle,
domain verification, notifications, lifecycle email, site generation, lead scans,
screenshots, crawls, browser jobs. Three execution planes exist (§19): Cloudflare
Workflows (CF-native durable orchestration), the self-hosted Inngest plane (§13,
event-driven product lifecycle), and Hatchet Cloud (heavy/stateful/long/browser/AI,
ADR-0004). Without a single routing policy, app code picks vendors ad-hoc — which
violates the ports/adapters rule (§11/§74.12) and scatters cost/retry/idempotency
decisions across the codebase.

## Decision

A pure `WorkflowRouter` (`src/platform/workflow-router.ts`) owns the choice:

- `chooseWorkflowBackend(flags)` — the §20 selection logic. CF-native + light →
  `cloudflare-workflows`; event-driven + light → `inngest`; anything
  heavy/browser/filesystem/stateful → `hatchet`. Default (unflagged) → `hatchet`.
- `JOB_DEFINITIONS` — every declared job kind with its routing flags + reliability
  contract (`maxRetries`, `timeoutSeconds`, `requiresIdempotency`, `producesArtifacts`,
  `costCategory`, …). Each definition's `defaultBackend` is **asserted by unit test**
  to equal `chooseWorkflowBackend(def)` — declaration and policy can never diverge.
- `routeJob(kind)` — recomputes the backend from the live policy (not blindly trusting
  the stored `defaultBackend`).

Preference order is strict (§76): Workflows first, Inngest second, Hatchet last —
"do not overuse Hatchet for small CF-native flows; do not overuse Inngest for flows
Workflows handles cleanly."

## Consequences

- Positive: one place to change routing; app code calls `routeJob(kind)`, never a
  vendor SDK; cost/retry/idempotency declared per job; testable in isolation (no I/O).
- Negative: backend adapters (`CloudflareWorkflowProvider`/`InngestProvider`/
  `HatchetProvider`) implementing `ProjectSitesJobProvider` are still to build — this
  slice is the routing brain, not yet the dispatch limbs.
- Neutral: `JOB_DEFINITIONS` is the SSOT for the admin job catalog (§66).

## Alternatives considered

- **Call vendors directly per job** — rejected: violates §11 ports/adapters; scatters
  policy; impossible to enforce the §76 preference order.
- **One backend for everything** — rejected: CF Workflows can't run heavy/browser/
  stateful jobs; Hatchet is wasteful for light CF-native flows.

## Migration notes

- Existing CF Workflows (`SiteGenerationWorkflow` et al.) keep running; they become
  the `cloudflare-workflows` adapter's targets when the provider lands.
- Site generation currently runs as a CF Workflow + Container; `JOB_DEFINITIONS`
  routes `site-generation` to `hatchet` (its true heavy home) — the adapter migration
  is gated + incremental, not a big-bang rewrite.

## Operational risks

- A mis-flagged job could route to the wrong plane (e.g. a browser job not flagged
  `needsBrowser` would wrongly pick Workflows). The `defaultBackend == policy` test
  catches divergence for declared jobs; new jobs must set flags accurately.

## Rollback strategy

- Pure library, no runtime wiring yet — reverting is a file delete. Once adapters
  land, each is feature-flagged (`workflows.cloudflare.enabled` / `workflows.inngest.enabled`
  / `workflows.hatchet.enabled`) so a plane can be disabled without code change.
