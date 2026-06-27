# llm.megabyte.space — LiteLLM proxy on CF Workers Containers.
#
# LiteLLM proxy is the OpenAI-compatible /v1 gateway (one base URL, every model,
# with routing, fallbacks, budgets, caching). Model routing is done natively in
# config.yaml (model_list + router_settings + fallbacks) — no external router.
#
# Stateless container (port 4000) — model creds arrive via env at boot; optional
# Postgres (Neon) only if key-management/spend-logs persistence is enabled.
FROM ghcr.io/berriai/litellm:main-stable@sha256:a50b02a6056095da29308310bb608f0509e08ddcd1d105bae9c21007d82b0e95

COPY config.yaml /app/config.yaml

EXPOSE 4000

# LiteLLM proxy server. --config wires the model_list + router_settings below.
# Bind 0.0.0.0 so the CFC proxy can reach the port.
CMD ["--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
