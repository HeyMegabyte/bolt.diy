# Unkey API (AGPL) — self-hosted at api.projectsites.dev, ISOLATED behind the HTTP
# boundary per agpl-isolation-via-http-boundary (own container/subdomain, no code import).
# Single published Go-binary image (distroless). CF Containers run native linux/amd64 on
# firecracker — pin --platform so the CI-built image is native amd64 (cf-containers-native-amd64-only).
# ENTRYPOINT ["/unkey"] runs the API server; it reads UNKEY_* env and binds
# UNKEY_HTTP_PORT (default 7070) on 0.0.0.0. Deps: MySQL (TiDB) + Redis (Upstash); ClickHouse
# + Vault are optional and omitted (analytics/encryption-at-rest disabled for v1).
FROM --platform=linux/amd64 unkeyed/unkey:v2.0.49

# Bump to force wrangler to compute a new image tag + rebuild on CI (cf-containers-native-amd64-only).
LABEL com.projectsites.cachebust="2026-06-29-1"

EXPOSE 7070
