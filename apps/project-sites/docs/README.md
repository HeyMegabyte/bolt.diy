# Worker Deep Docs

Deep reference docs for the projectsites.dev Cloudflare Worker (`apps/project-sites/src`).
Start at the worker guide: [`../CLAUDE.md`](../CLAUDE.md).

## Reference

- [`API_REFERENCE.md`](./API_REFERENCE.md) — Worker API surface (routes + endpoints)
- [`OPERATIONS.md`](./OPERATIONS.md) — operations runbook (deploy, monitoring, recovery)
- [`CONTAINER_MANIFEST.md`](./CONTAINER_MANIFEST.md) — every Docker container under `projectsites.dev`
- [`admin-convergence-tdd.md`](./admin-convergence-tdd.md) — admin contract-driven TDD system

## Architecture

- [`architecture/cloudflare-first.md`](./architecture/cloudflare-first.md) — Cloudflare-first infra doctrine + bindings
- [`architecture/feature-flags.md`](./architecture/feature-flags.md) — feature-flag system
- [`architecture/service-registry.md`](./architecture/service-registry.md) — service registry
- [`security/secret-at-rest-audit.md`](./security/secret-at-rest-audit.md) — secret-at-rest audit
- [`lead-scanner/automatic-engine.md`](./lead-scanner/automatic-engine.md) — lead-scanner engine

## Decisions

- [`decisions/voice-architecture.md`](./decisions/voice-architecture.md) — voice architecture ADR
- [`perf-wave-ag-grid-to-tanstack.md`](./perf-wave-ag-grid-to-tanstack.md) — ag-grid → TanStack migration record (complete)
