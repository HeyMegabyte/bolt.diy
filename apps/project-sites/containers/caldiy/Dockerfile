# cal.diy (Cal.com community distro) self-host for schedule.projectsites.dev —
# CF Workers Container. FROM the official published image (local-Dockerfile path
# bypasses IMAGE_REGISTRY_NOT_CONFIGURED, same as the other containers). Pairs
# with the CaldiyContainer DO + [[env.production.containers]] block + the
# schedule.* host dispatch. Listens on 3000; runs prisma migrate on first boot.
# NEXT_PUBLIC_WEBAPP_URL is build-time but the image rebuilds static files at
# start when it differs → a slight first-boot delay (long port-ready window).
# cal.diy is Postgres-ONLY (no Redis).
#
# Required runtime env (injected via CaldiyContainer envVars from CALDIY_* secrets):
#   DATABASE_URL              Neon project "Caldiy" (empty-surf-47784419)
#   NEXTAUTH_SECRET           openssl rand -base64 32
#   CALENDSO_ENCRYPTION_KEY   openssl rand -base64 32 (AES-256)
#   NEXT_PUBLIC_WEBAPP_URL    https://schedule.projectsites.dev
#   NEXTAUTH_URL              https://schedule.projectsites.dev
FROM calcom/cal.diy:latest
EXPOSE 3000
