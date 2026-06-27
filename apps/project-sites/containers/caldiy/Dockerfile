# cal.diy (Cal.com community distro) self-host for schedule.projectsites.dev —
# CF Workers Container. NOTE: calcom/cal.diy publishes NO Docker image (it is a
# source-only repo); the official published image is `calcom/cal.com`, which IS
# the same community app (enterprise features are license-key-gated, absent
# without keys = effectively cal.diy). Local-Dockerfile path bypasses
# IMAGE_REGISTRY_NOT_CONFIGURED. Listens on 3000; runs prisma migrate on first
# boot + rebuilds static files for the runtime NEXT_PUBLIC_WEBAPP_URL.
# cal.diy/cal.com is Postgres-ONLY (no Redis).
#
# Required runtime env (injected via CaldiyContainer envVars from CALDIY_* secrets):
#   DATABASE_URL              Neon project "Caldiy" (empty-surf-47784419)
#   NEXTAUTH_SECRET           openssl rand -base64 32
#   CALENDSO_ENCRYPTION_KEY   openssl rand -base64 32 (AES-256)
#   NEXT_PUBLIC_WEBAPP_URL    https://schedule.projectsites.dev
#   NEXTAUTH_URL              https://schedule.projectsites.dev
FROM calcom/cal.com:latest
EXPOSE 3000
