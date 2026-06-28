# llm.megabyte.space — LiteLLM proxy on CF Workers Containers.
#
# LiteLLM proxy is the OpenAI-compatible /v1 gateway (one base URL, every model,
# with routing, fallbacks, budgets, caching). Model routing is LiteLLM-NATIVE:
# config.yaml defines an `auto_router/adaptive_router` "smart" entrypoint that
# adaptively picks the cheapest model meeting the prompt's quality bar.
#
# Pinned to main-LATEST (not -stable): the native adaptive_router (+ its bundled
# semantic_router dep) landed after the -stable digest — verified present + booting
# WITHOUT a DATABASE_URL in this digest (2026-06-27). No pip install needed; the
# image already ships adaptive_router + semantic_router 0.1.2.
#
# Stateless container (port 4000) — model creds arrive via env at boot.
FROM ghcr.io/berriai/litellm:main-latest@sha256:76a461132b9abdc032bab4d31d8ba77410ec06e99a14d05971fdfc2d82e6e785

# Cache-bust LABEL: bump to force a new image hash → CF cold-starts the container so
# worker.ts envVar changes (e.g. LANGFUSE_* forwarding) actually reach the running proxy.
LABEL dev.projectsites.config-rev="2026-06-27-langfuse-flush1"
COPY config.yaml /app/config.yaml
# Meta-LLM hooks pipeline (refiner / injection-scan / PII / compress / brand / …),
# mounted via config callbacks. /app is on sys.path so `projectsites_hooks` imports.
COPY projectsites_hooks.py /app/projectsites_hooks.py
# CF-native arbitration models (cascade / quorum) — cheap legs on Workers AI.
COPY projectsites_arbiter.py /app/projectsites_arbiter.py

EXPOSE 4000

# LiteLLM proxy server. --config wires the model_list + router_settings below.
# Bind 0.0.0.0 so the CFC proxy can reach the port.
CMD ["--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
