# Langfuse — Superseded by Langfuse Cloud

**Decision date:** 2026-06-29
**Status:** SUPERSEDED — infrastructure retained for reference, NOT deployed or active.

## Context

This directory contained the self-hosted Langfuse v3 deployment on Cloudflare Containers
(via `traces.projectsites.dev`). The full topology was:

- **Langfuse web** — CF Container (`langfuse/langfuse:3`), DO subclass `Langfuse`
- **Langfuse worker** — Fly.io (`langfuse-worker/fly.toml`), background queue processor
- **Postgres** — Neon project
- **ClickHouse** — Fly.io (`infra/clickhouse/`)
- **Redis** — Upstash
- **S3** — Cloudflare R2

## Decision

We now use **Langfuse Cloud** (US region):

- Base URL: `https://us.cloud.langfuse.com`
- Secrets set via `wrangler secret put LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_BASE_URL`
- Worker `Env` interface already declares these fields (optional, `app/project-sites/src/types/env.ts`)

Self-hosting Langfuse required running ClickHouse (which no Cloudflare primitive replaces),
creating unnecessary operational overhead. Langfuse Cloud eliminates this infrastructure
while providing the same observability API.

## Cleanup

The infra/langfuse/ and infra/langfuse-worker/ directories remain committed for reference.
They are NOT deployed and should be pruned in a future cleanup pass.
