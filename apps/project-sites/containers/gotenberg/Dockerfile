# Gotenberg (Office→PDF conversion) for convert.projectsites.dev — CF Workers Container.
# Powers Documenso's document-conversion path: .docx/.xlsx/.pptx → PDF via LibreOffice.
# FROM the official published image so Cloudflare's build pulls prebuilt layers.
# Pairs with the GotenbergContainer DO + [[env.production.containers]] block + the
# convert.* host dispatch. Listens on :3000.
#
# Basic auth is REQUIRED (the endpoint is reachable over the public edge): the
# `--api-enable-basic-auth` flag makes Gotenberg read GOTENBERG_API_BASIC_AUTH_USERNAME
# / _PASSWORD, which GotenbergContainer injects from the GOTENBERG_AUTH_* worker secrets.
# Documenso sends those same creds via NEXT_PRIVATE_DOCUMENT_CONVERSION_USERNAME/_PASSWORD.
FROM gotenberg/gotenberg:8
EXPOSE 3000
ENTRYPOINT ["gotenberg"]
CMD ["--api-enable-basic-auth"]

# Real-instruction cache-bust (ENV creates a layer → new image digest → CF cold-boots
# the container with the current GOTENBERG_AUTH_* secrets). Bump to force a restart.
ENV CONTAINER_REV="rev2-2026-06-27"
