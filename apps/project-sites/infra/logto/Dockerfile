# Logto — self-hosted auth (OIDC) for auth.projectsites.dev on CF Workers Containers.
# State lives in Neon Postgres (CF Containers have no persistent volume). First boot
# seeds the FULL schema (`db seed`); later boots run pending migrations, then start.
FROM svhd/logto:1.23
ENTRYPOINT ["sh", "-c", "npm run cli db seed 2>/dev/null || npm run cli db alteration deploy 2>/dev/null || true; exec npm start"]
