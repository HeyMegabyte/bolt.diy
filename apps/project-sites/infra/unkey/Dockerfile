# Unkey API (AGPL) — self-hosted at api.projectsites.dev, ISOLATED behind the HTTP
# boundary per agpl-isolation-via-http-boundary (own container/subdomain, no code import).
#
# TEMPORARY DIAGNOSTIC BUILD: the plain distroless unkeyed/unkey image gives NO container-stdout
# visibility on CF, so a boot crash just shows as a Worker 1101. This alpine wrapper runs the
# static /unkey binary and, IF it crash-exits before binding :7070, serves the captured boot log
# on :7070 via busybox httpd → `curl https://api.projectsites.dev/unkey.log` shows the error.
# Healthy case is unaffected (unkey holds :7070; httpd never starts). Revert to the one-line
# `FROM ghcr.io/unkeyed/unkey:v2.0.49` once Unkey boots clean. See entrypoint.sh.
#
# CF Containers run native linux/amd64 (firecracker) — pin --platform (cf-containers-native-amd64-only).
FROM --platform=linux/amd64 alpine:3.20

RUN apk add --no-cache busybox-extras

# /unkey is a static Go binary (built from distroless/static) → runs on alpine/musl unchanged.
COPY --from=ghcr.io/unkeyed/unkey:v2.0.49 /unkey /unkey
COPY unkey.toml /unkey.toml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /unkey

# Bump to force wrangler to compute a new image tag + rebuild on CI (cf-containers-native-amd64-only).
LABEL com.projectsites.cachebust="2026-06-29-diag-1"

EXPOSE 7070
ENTRYPOINT ["/entrypoint.sh"]
