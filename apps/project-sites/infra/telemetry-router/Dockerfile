# telemetry.projectsites.dev — OpenTelemetry Collector (Contrib) on CF Workers Containers.
# Internal-only: Cloudflare Access policy gates unauthenticated requests at the edge.
# Workers send OTLP to this container; it routes to Axiom (and optionally other backends).
FROM otel/opentelemetry-collector-contrib:latest

COPY collector.yaml /etc/otelcol-contrib/config.yaml

# 4317 = OTLP gRPC receiver
# 4318 = OTLP HTTP receiver (the defaultPort the Container DO forwards to)
EXPOSE 4317 4318
