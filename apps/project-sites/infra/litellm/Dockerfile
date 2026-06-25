# llm.megabyte.space — LiteLLM proxy + RouteLLM routing on CF Workers Containers.
#
# LiteLLM proxy is the OpenAI-compatible /v1 gateway (one base URL, every model,
# with routing, fallbacks, budgets, caching). RouteLLM rides in the SAME image as
# a routing strategy: a learned router picks strong-vs-weak per request to cut cost.
#
# Stateless container (port 4000) — model creds arrive via env at boot; optional
# Postgres (Neon) only if key-management/spend-logs persistence is enabled.
FROM ghcr.io/berriai/litellm:main-stable

# RouteLLM lives in the same image so a `router/*` model in config.yaml resolves.
# The LiteLLM base image is a uv-managed venv at /app/.venv with NO pip on PATH —
# bootstrap pip via ensurepip into that venv. Install the CPU-only torch wheel FIRST
# (routellm's default torch dep pulls ~2GB of CUDA libs and blows the CF image-size
# budget) so routellm sees torch already satisfied — keeps the image lean + functional.
RUN /app/.venv/bin/python -m ensurepip --upgrade \
 && /app/.venv/bin/python -m pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu torch \
 && /app/.venv/bin/python -m pip install --no-cache-dir routellm

COPY config.yaml /app/config.yaml

EXPOSE 4000

# LiteLLM proxy server. --config wires the model_list + router_settings below.
# Bind 0.0.0.0 so the CFC proxy can reach the port.
CMD ["--config", "/app/config.yaml", "--host", "0.0.0.0", "--port", "4000"]
