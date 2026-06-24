# 0035 — OpenTelemetry span port over Workers Tracing (not the OTel SDK)

**Status:** accepted
**Date:** 2026-06-24
**Deciders:** Brian Zalewski

## Context

§35 of the convergence include-list calls for OpenTelemetry. ProjectSites already
has a layered observability backbone:

- **CF Workers Tracing** (`[observability]` in wrangler) — zero-config OTLP tracing
  of every I/O span, the always-on backbone
- **`lib/log.ts`** — structured logs carrying `traceId`/`requestId` correlation
- **Sentry** — exception spans; **PostHog** — product events; **AI Gateway** — LLM
  call logs

What's missing is an app-level, vendor-neutral `Tracer.startSpan(...)` surface and
the ability to export custom business spans (lead→claim→checkout funnel steps,
generation pipeline phases) to an OTLP backend (Honeycomb / Grafana / Axiom).

Adopting the full `@opentelemetry/*` SDK is the wrong tool here: it's heavy, not
Workers-tuned (Node globals, async-hooks context propagation), and would duplicate
the context Workers Tracing already provides.

## Decision

Ship a thin in-house **OpenTelemetry-shaped span port**, no SDK:

- `platform/tracing.ts` — `Tracer` / `Span` / `TracerProvider` interfaces +
  `RecordingSpan` + `NoopTracerProvider` (zero-overhead default) +
  `FakeTracerProvider` (tests).
- `middleware/tracing.ts` — `OtlpTracerProvider`: a fetch-based **OTLP/HTTP JSON**
  exporter (`buildOtlpPayload` → `resourceSpans/scopeSpans/spans`) + Zod-validated
  config + `getTracerProvider(env)`.

Spans complement (never replace) Workers Tracing. App code emits a span and flushes
in `ctx.waitUntil(provider.flush())`.

## Consequences

- **Positive:** standard span API + OTLP export to any backend, zero new deps,
  Workers-native (pure fetch). Backend is swappable via one env var.
- **Positive:** ships **dark** — no `OTEL_EXPORTER_OTLP_ENDPOINT` → `NoopTracerProvider`
  (inert spans, zero overhead, no behavior change). Export is fail-soft: a failed
  POST is swallowed, never breaks a request.
- **Negative:** not the OTel SDK, so auto-instrumentation + W3C `traceparent`
  context propagation aren't built in (manual `traceId`/`parentSpanId` threading).
  Acceptable — Workers Tracing already auto-instruments I/O; this port is for
  deliberate business spans.
- **Neutral:** the port is `scaffolded` until `getTracerProvider` + `waitUntil(flush)`
  are wired into hot handlers (site-serving, workflow steps).

## Alternatives considered

- **Adopt `@opentelemetry/*` SDK** — rejected: heavy, Node-oriented, duplicates
  Workers Tracing's context; the OTLP wire format is the value, not the SDK.
- **Rely only on Workers Tracing** — insufficient: it traces I/O, not custom
  business spans, and can't target an arbitrary external OTLP backend per-deploy.
- **Do nothing** — leaves §35 unaddressed and business-funnel spans unexportable.
