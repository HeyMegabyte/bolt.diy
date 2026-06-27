# Formbricks self-host for survey.projectsites.dev — CF Workers Container.
# FROM the official published image so Cloudflare's build pulls prebuilt layers
# (no upstream source clone, no external-registry dependency). Pairs with the
# FormbricksContainer DO subclass + [[env.production.containers]] block + the
# survey.* host dispatch. Listens on 3000.
#
# Required runtime env (injected via AppRuntime env resolution / app_instances):
#   DATABASE_URL        Neon project "Formbricks" (wild-sound-20069767)
#   NEXTAUTH_SECRET     openssl rand -hex 32
#   ENCRYPTION_KEY      openssl rand -hex 16   (MUST be exactly 32 chars — Formbricks zod-validates length)
#   WEBAPP_URL          https://survey.projectsites.dev
#   NEXTAUTH_URL        https://survey.projectsites.dev
FROM ghcr.io/formbricks/formbricks:latest
EXPOSE 3000
