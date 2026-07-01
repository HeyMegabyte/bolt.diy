# Lago billing — all-in-one image (front-end nginx :80 + API Rails :3000)
FROM getlago/lago:latest
EXPOSE 80 3000

# Add API proxy config that loads BEFORE the entrypoint-generated config.
# The stock Lago entrypoint generates an /api/ proxy that blocks POST to /api/graphql.
# nginx "first match wins" for location blocks, so our 00- prefix sorts first.
COPY nginx-api.conf /etc/nginx/extra-conf.d/00-api-proxy.conf
