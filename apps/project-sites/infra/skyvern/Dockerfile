# browser.projectsites.dev — Skyvern (LLM browser-automation agent) on CF Workers Containers.
#
# Skyvern drives a real browser with an LLM to complete web tasks (form fill, scrape,
# multi-step flows). The official all-in-one image bundles the API + a headless
# Chromium, so one container serves the agent API on port 8000.
#
# Heavy image (Chromium baked in, ~2GB) → standard-4 instance. Postgres → Neon;
# an LLM key (OpenAI/Anthropic) powers the agent. AGPL-3.0 — internal/admin use.
FROM public.ecr.aws/skyvern/skyvern:latest@sha256:870a880f5fe1647e50a5069163609918a222023aca3c30e3d69113147a2ed796
EXPOSE 8000

# The base image's entrypoint launches the Skyvern API server on :8000. Keep the
# default CMD; env (DATABASE_STRING + LLM keys) arrives at boot via the Container DO.
