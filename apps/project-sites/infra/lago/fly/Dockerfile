# Full Lago stack for Fly.io — nginx :80 + Procfile (web + worker + clock)
FROM getlago/lago:latest

# Add nginx API proxy config to allow POST to /api/graphql
COPY nginx-api.conf /etc/nginx/extra-conf.d/00-api-proxy.conf

# Save original runner.sh, then replace with wrapper that also starts nginx
RUN mv /app/runner.sh /app/runner-orig.sh
COPY start.sh /app/runner.sh
RUN chmod +x /app/runner.sh
