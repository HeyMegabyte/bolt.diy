# langflow.projectsites.dev — Langflow visual AI workflow builder on CF Workers Containers.
#
# Langflow is a Python FastAPI app that serves on port 7860. Its data plane is external:
#   - Postgres → Neon  (LANGFLOW_DATABASE_URL, wrangler secret)
#
# Pin 1.10.1 (2026-06-30 latest stable). The official image runs `langflow run` by default
# which binds 0.0.0.0:7860 and handles migrations on boot when LANGFLOW_DATABASE_URL is set.
FROM langflowai/langflow:1.10.1

# Cache-bust LABEL: bump to force a new image hash → CF cold-starts the container so
# worker.ts envVar changes actually reach the running server.
LABEL dev.projectsites.config-rev="2026-07-01-new-user-active"

EXPOSE 7860
