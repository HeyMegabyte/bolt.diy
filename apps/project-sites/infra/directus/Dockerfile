# Directus headless CMS — CF Workers Container (port 8055)
# Pinned to v12.0.2 (stable). CF Containers run native amd64.
FROM directus/directus:12.0.2

USER root

# Ensure no stray apt caches or unnecessary packages
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

USER node

EXPOSE 8055

CMD ["npx", "directus", "start"]
