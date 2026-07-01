# SearXNG for ProjectSites.dev — private search infrastructure
# Deployed as CF Workers Container behind Cloudflare Access.
# Uses stock SearXNG entrypoint — config injected via env vars + copied files.
FROM searxng/searxng:latest

# Copy SearXNG configuration files into the config directory
COPY searxng/settings.yml /etc/searxng/settings.yml
COPY searxng/limiter.toml /etc/searxng/limiter.toml

# SearXNG listens on 8080 internally
EXPOSE 8080

# Use stock SearXNG entrypoint (/usr/local/searxng/entrypoint.sh)
# Config is at /etc/searxng/ — already set as $__SEARXNG_CONFIG_PATH.
# Secrets (SEARXNG_SECRET, SEARXNG_VALKEY_URL) injected as env vars
# by the CF Workers Container runtime.
