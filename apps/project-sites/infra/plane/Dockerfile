# Plane all-in-one (AIO) — ONE image runs every Plane process (web + space + admin + api +
# celery worker + beat) behind Plane's own internal supervisor + proxy on a single port (80).
# This is the CF Workers Containers fit: one Container DO, the Worker just forwards to :80.
# External data plane only: Neon (Postgres) · Upstash (Redis) · CloudAMQP (RabbitMQ) · R2 (S3).
#
# ⚠ Pin to a specific Plane CE release before prod. The AIO image is Plane's published
# all-in-one (built from the repo `aio/` Dockerfile). If the registry tag differs on bump,
# update here. AIO runs DB migrations itself on boot.
FROM makeplane/plane-aio:stable
EXPOSE 80
