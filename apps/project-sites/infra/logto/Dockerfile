# Logto self-hosted auth for auth.projectsites.dev on CF Workers Containers.
# State in Neon Postgres (no persistent volume). The svhd/logto image AUTO-runs
# DB migration + seed on boot when DB_URL is set, then starts core(:3001)+admin(:3002).
# Do NOT override ENTRYPOINT — the image's own startup handles seed+serve correctly.
FROM svhd/logto:1.23
