# Nango — unified integrations/OAuth gateway for integrations.projectsites.dev on
# CF Workers Containers. Self-hosted open-source server image (nango-server:hosted).
# State in Neon Postgres + Upstash Redis. DB migrations run on boot (server.js).
# Server listens on SERVER_PORT (env var, default 8080).
FROM nangohq/nango-server:hosted-0.70.9

# Base ENTRYPOINT docker-entrypoint.sh prepends "node" to any CMD that isn't a
# system command. Since "node" IS a system command, the entrypoint passes it
# through unchanged. This bypasses the wrapper script entirely — server.js runs
# migrations inline at startup and then binds to SERVER_PORT.
CMD ["node", "packages/server/dist/server.js"]
