# Logto — self-hosted auth (OIDC) for auth.projectsites.dev on CF Workers Containers.
# CF Containers have no persistent volume → all state lives in Neon Postgres.
# The svhd/logto image seeds + migrates the schema idempotently on boot, then starts
# the core (sign-in) server on :3001 and the admin console on :3002.
FROM svhd/logto:1.23

# Seed/upgrade the DB idempotently every boot (no-op when current), then exec Logto.
# DB_URL comes from the container env (Neon). `--swe` seeds the default sign-in experience.
ENTRYPOINT ["sh", "-c", "npm run cli db seed -- --swe || npm run cli db alteration deploy || true; exec npm start"]
