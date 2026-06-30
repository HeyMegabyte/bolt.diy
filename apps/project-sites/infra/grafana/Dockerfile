# Grafana 12.2.10 — observability dashboard at grafana.projectsites.dev
# Stateless container: all state in Neon Postgres (GF_DATABASE_TYPE=postgres).
# CF Containers run native linux/amd64 (firecracker) — pin --platform.
FROM --platform=linux/amd64 grafana/grafana:12.2.10

# Provisioning files baked into the image — datasources, dashboards, alerting.
COPY provisioning /etc/grafana/provisioning
COPY dashboards /var/lib/grafana/dashboards

# Bump to force wrangler to compute a new image tag + rebuild on CI.
LABEL com.projectsites.cachebust="2026-06-30-v1"

EXPOSE 3000
