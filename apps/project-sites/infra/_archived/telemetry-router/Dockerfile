# telemetry.projectsites.dev — OpenTelemetry Collector (Contrib) on CF Workers Containers.
# Internal-only: Cloudflare Access policy gates unauthenticated requests at the edge.
# Workers send OTLP to this container; it routes to Axiom (and optionally other backends).
FROM otel/opentelemetry-collector-contrib:latest@sha256:4935caa35e9a4cb387e35732e8fb22b2b5759af8d12e7043357f03837f6e8df5
COPY collector.yaml /etc/otelcol-contrib/config.yaml

# 4317 = OTLP gRPC receiver
# 4318 = OTLP HTTP receiver (the defaultPort the Container DO forwards to)
EXPOSE 4317 4318
