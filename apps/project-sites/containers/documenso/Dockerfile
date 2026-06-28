# Documenso self-host for sign.projectsites.dev — CF Workers Container.
# FROM the official published image so Cloudflare's build pulls prebuilt layers
# (no upstream source clone, no external-registry dependency — same mechanism as
# InngestContainer/SiteBuilderContainer). Pairs with the DocumensoContainer DO +
# [[env.production.containers]] block + the sign.* host dispatch. Listens on 3000;
# runs `prisma migrate deploy` on first boot.
#
# Required runtime env (injected via DocumensoContainer envVars from DOCUMENSO_* secrets):
#   NEXT_PRIVATE_DATABASE_URL              Neon project "Documenso" (shiny-wind-41827027)
#   NEXTAUTH_SECRET                        openssl rand -base64 32
#   NEXT_PRIVATE_ENCRYPTION_KEY            openssl rand -base64 32 (>=32 chars)
#   NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY  openssl rand -base64 32 (>=32 chars)
#   NEXT_PUBLIC_WEBAPP_URL                 https://sign.projectsites.dev
#   NEXT_PRIVATE_INTERNAL_WEBAPP_URL       http://localhost:3000
#   NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS  base64 p12 (optional for boot, needed to SIGN)
#   NEXT_PRIVATE_SIGNING_PASSPHRASE        p12 passphrase
# Documenso is Postgres-only (NO Redis required).
FROM documenso/documenso:latest
EXPOSE 3000

# Real-instruction cache-bust (ENV creates a layer → new image digest → CF cold-boots
# Documenso so it picks up the stable NEXT_PRIVATE_DOCUMENT_CONVERSION_* creds).
ENV CONTAINER_REV="rev3-2026-06-27-google"
