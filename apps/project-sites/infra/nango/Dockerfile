# Nango — unified integrations/OAuth gateway for integrations.projectsites.dev on
# CF Workers Containers. Self-hosted via the managed OSS image (contains full monorepo).
# State in Neon Postgres + Upstash Redis. DB migrations run on boot.
# The hosted image (nangohq/nango-server:hosted) uses the same DB but different
# migration set — we use the managed tag because it's proven to boot to port 8080.
FROM nangohq/nango:managed-1.5.11-0.70.8-aae30d044d7e229807d51a3957c212f3fb689e1a

# The managed base image defaults to ENTRYPOINT ["docker-entrypoint.sh"] CMD ["node"].
# docker-entrypoint.sh prepends "node" to any non-system-command CMD value — so our
# bash script would be executed as `node entrypoint.sh` (silent failure).
# Override ENTRYPOINT to empty so CMD runs directly as a shell command.
ENTRYPOINT []
CMD ["/app/nango/packages/server/entrypoint.sh"]
