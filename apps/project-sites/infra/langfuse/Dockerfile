# traces.projectsites.dev — Langfuse v2 (LLM observability/tracing) on CF Containers.
#
# Langfuse v2 is a SINGLE Next.js container (port 3000) backed by Postgres only —
# the v2 line fits the CFC + Neon stack. (v3 split into web/worker + ClickHouse +
# Redis + S3, which the catalog criteria exclude.) Prisma runs DB migrations on boot.
FROM langfuse/langfuse:2@sha256:85c278dcab96c15db94191a5c1664f85aba2d7fb6771a00e99681c902c4b7015
EXPOSE 3000
# The base image's entrypoint runs prisma migrate deploy then starts Next.js on :3000.
# Env (DATABASE_URL + NEXTAUTH_* + SALT) arrives at boot via the Container DO.
