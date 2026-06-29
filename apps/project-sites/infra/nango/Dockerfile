# Nango — unified integrations/OAuth gateway for integrations.projectsites.dev on
# CF Workers Containers. Self-hosted OSS image (NOT the Cloud "hosted" variant —
# that one has a different entrypoint and won't boot without Cloud infra).
# State in Neon Postgres + Upstash Redis. DB migrations run on boot.
# Latest managed tag: v0.70.8 (nangohq/nango:managed-1.5.11-0.70.8)
#
# The managed base image contains the full Nango monorepo at /app/nango/.
# SERVER_RUN_MODE=DOCKERIZED is set in the base image env.
# We override CMD to run the self-hosted server entrypoint (base defaults to
# bare "node" which exits immediately in non-interactive mode).
FROM nangohq/nango:managed-1.5.11-0.70.8-aae30d044d7e229807d51a3957c212f3fb689e1a

# Remove Nango-Cloud-specific packages (not needed for self-hosted).
# The self-hosted entrypoint starts the server + runs migrations.
RUN rm -rf /app/nango/packages/jobs \
  && rm -rf /app/nango/packages/runner \
  && rm -rf /app/nango/packages/persist

CMD ["/app/nango/packages/server/entrypoint.sh"]