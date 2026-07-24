# Grafana 12.2.10 — observability dashboard at grafana.projectsites.dev
# Stateless container: all state in Neon Postgres via pooled connection.
# CF Containers run native linux/amd64 (firecracker) — pin --platform.
# NOTE: provisioning files are NOT copied — Neon's pgbouncer (transaction mode)
# breaks prepared statements used by the provisioning engine. Provision datasources
# and dashboards via Grafana's HTTP API or UI after first login.
FROM --platform=linux/amd64 grafana/grafana:12.2.10

# Bump to force wrangler to compute a new image tag + rebuild on CI.
LABEL com.projectsites.cachebust="2026-07-01-v4"

EXPOSE 3000
