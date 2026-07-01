# OpenHands Agent Canvas — Fly.io origin
# Official image + thin Node.js origin-gateway on :8080
# Gateway validates X-ProjectSites-Origin-Secret → proxies to :8000

FROM ghcr.io/openhands/agent-canvas:1.1.0

USER root
COPY gateway.mjs /gateway.mjs
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080
ENTRYPOINT ["/start.sh"]
