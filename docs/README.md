# Docs

Canonical documentation for projectsites.dev. The published MkDocs site builds from
[`docs/docs/`](./docs/) (`mkdocs.yml`); the files below are the source-of-truth references.

## Start here

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — shipped Worker topology, data flow, D1 schema
- [`STACK.md`](./STACK.md) — tooling matrix + convergence work items (most current)
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — auth chain, bindings, smoke-test matrix, rollback
- [`REQUIREMENTS.md`](./REQUIREMENTS.md) — requirement checklist (built / deferred)
- [`SUBDOMAINS.md`](./SUBDOMAINS.md) — public subdomain/service map

## AI + prompts

- [`AI_INTEGRATION.md`](./AI_INTEGRATION.md) — AI Gateway, Vectorize/RAG, PostHog LLM-obs
- [`ai-observability.md`](./ai-observability.md) — AI governance: trace, eval, budget, fallback
- [`ai-agent-rules.md`](./ai-agent-rules.md) — Cloudflare-first package + integration policy
- [`PROMPTS.md`](./PROMPTS.md) — prompt infrastructure (`.prompt.md`, registry, A/B)
- [`generated-site-quality.md`](./generated-site-quality.md) — quality gates for generated sites

## Subsystem docs

- [`observability/`](./observability/) — logging, OTel, PostHog, Axiom
- [`analytics/`](./analytics/) — ClickHouse warehouse, ingestion pipeline
- [`social/`](./social/) — native social-publishing architecture + Postiz reference
- [`services/`](./services/) — Chatwoot, Postiz deploy/integration
- [`deployment/`](./deployment/) — Fly.io runbook, post-deploy verification
- [`architecture/`](./architecture/) — as-deployed map, Fly/Cloudflare split
- [`maintenance/`](./maintenance/) — dead-code + Zod-validation audit records
- [`cx-improvements/`](./cx-improvements/) + [`page-improvements/`](./page-improvements/) — feature backlogs
- [`security-supply-chain.md`](./security-supply-chain.md) · [`tooling-matrix.md`](./tooling-matrix.md) · [`TESTING.md`](./TESTING.md)

## Decisions

- [`../DECISIONS.md`](../DECISIONS.md) — root architecture ADR log (0001–0011)
- [`../apps/project-sites/docs/adr/`](../apps/project-sites/docs/adr/) — convergence ADR series

The Worker's own deep docs live in [`../apps/project-sites/docs/`](../apps/project-sites/docs/).
