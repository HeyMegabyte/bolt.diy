# traces.projectsites.dev — Langfuse v3 web (LLM observability/tracing) on CF Containers.
#
# v3 backends (the full self-host topology): Postgres → Neon, ClickHouse → Fly.io
# (projectsites-clickhouse, no CF primitive for ClickHouse), Redis → Upstash, S3 → R2.
# On first boot the web runs the PG + ClickHouse migrations, then serves Next.js on :3000
# (login at /auth/sign-in → 200). The background queue WORKER (langfuse/langfuse-worker:3)
# runs separately (Fly) — the web alone serves the UI; the worker drains ingested traces.
FROM langfuse/langfuse:3@sha256:4bf0e8dbce77521f3b628e5939e6e543f61b76d8b47275f65082b1c113c77bc4
EXPOSE 3000
