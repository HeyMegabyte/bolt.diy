# SearXNG for ProjectSites.dev — private search infrastructure
# Deployed as CF Workers Container behind Cloudflare Access.
#
# Lint: hadolint Dockerfile (DL3006 pin digest, DL3008 pin versions)
FROM searxng/searxng:latest

# Copy SearXNG configuration files
COPY searxng/settings.yml /etc/searxng/settings.yml
COPY searxng/limiter.toml /etc/searxng/limiter.toml

# Entrypoint wraps the stock SearXNG entrypoint:
# 1. Fixes Upstash Redis URL scheme (redis:// → valkey://) if needed
# 2. Verifies /etc/searxng/ ownership for the searxng user
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# SearXNG listens on 8080 internally
EXPOSE 8080

# Health check — process-level only, no external engine calls
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=2 \
  CMD ["/usr/bin/pgrep", "-f", "searxng"]

ENTRYPOINT ["/entrypoint.sh"]
