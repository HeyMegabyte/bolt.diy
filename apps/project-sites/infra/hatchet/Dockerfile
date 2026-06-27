# jobs.projectsites.dev — Hatchet (distributed task queue/orchestration) on CF Containers.
#
# Brian 2026-06-25: jobs. → Hatchet INSTEAD of Inngest (events. stays Inngest).
# hatchet-lite bundles engine + API + dashboard in ONE container (port 8888) backed
# by Postgres only — fits the CFC + Neon stack (modern Hatchet dropped the RabbitMQ
# dependency for a Postgres-backed queue).
FROM ghcr.io/hatchet-dev/hatchet/hatchet-lite:latest@sha256:30ff826bdc65efc15a46df61e6d16dcc52f76cf2cf2693e848c6789e2b48718f
# 8888 = dashboard + REST API (the port the Container DO proxies).
# 7077 = engine gRPC (SDK connect; reserved).
EXPOSE 8888 7077
# The lite image's entrypoint runs migrations + starts engine+api+dashboard on :8888.
# Env (DATABASE_URL + SERVER_* secrets/keysets) arrives at boot via the Container DO.
