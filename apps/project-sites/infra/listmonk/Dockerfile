FROM listmonk/listmonk:v4.1.0

# Install + upgrade schema idempotently on every container start, then exec the app.
# CF Containers have no persistent volume — schema/data live in Neon Postgres, so
# --upgrade is a no-op when the DB is already current.
ENTRYPOINT ["sh", "-c", "yes | ./listmonk --install --idempotent --upgrade --config '' && exec ./listmonk --config ''"]
