# Unkey API (AGPL) — self-hosted at api.projectsites.dev, ISOLATED behind the HTTP
# boundary per agpl-isolation-via-http-boundary (own container/subdomain, no code import).
# Published to GHCR (NOT Docker Hub — docker.io/unkeyed/unkey 401s). CF Containers run native
# linux/amd64 (firecracker) — pin --platform (cf-containers-native-amd64-only).
#
# The image's ENTRYPOINT is the unkey CLI; running it bare just prints help + exits (→ Worker
# 1101 / no :7070). The API server starts with the `run api` subcommand (verified locally:
# `docker run … unkeyed/unkey:v2.0.49 run api` → "database connection pool initialized" + routes
# registered). So CMD = ["run","api"]. Config comes from /unkey.toml (UNKEY_CONFIG), whose
# ${UNKEY_*} placeholders are env-expanded from the secrets injected by worker.ts.
FROM --platform=linux/amd64 ghcr.io/unkeyed/unkey:v2.0.146

COPY unkey.toml /unkey.toml

# Bump to force wrangler to compute a new image tag + rebuild on CI (cf-containers-native-amd64-only).
LABEL com.projectsites.cachebust="2026-06-29-runapi-1"

EXPOSE 7070
CMD ["run", "api"]
