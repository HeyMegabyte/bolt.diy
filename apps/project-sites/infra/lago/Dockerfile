# Lago billing — all-in-one image (front-end nginx :80 + API Rails :3000)
FROM getlago/lago:latest
EXPOSE 80 3000

# Add API proxy that allows POST to /api/graphql (stock nginx config blocks it)
COPY nginx-api.conf /etc/nginx/extra-conf.d/00-api-proxy.conf

# Ensure DB migrations run before Rails starts
# The stock entrypoint starts nginx + Rails; we add a db:prepare step.
# Override the entrypoint to add DB setup.
COPY entrypoint.sh /custom-entrypoint.sh
RUN chmod +x /custom-entrypoint.sh
ENTRYPOINT ["/custom-entrypoint.sh"]
