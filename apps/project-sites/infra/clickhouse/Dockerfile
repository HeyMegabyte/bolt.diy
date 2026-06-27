# ClickHouse for Langfuse v3 trace OLAP — runs on Fly.io (no CF primitive for ClickHouse).
# Langfuse connects via CLICKHOUSE_URL (:8123 HTTP) + CLICKHOUSE_MIGRATION_URL (:9000 native).
FROM clickhouse/clickhouse-server:25.3
# Listen on all interfaces (default is loopback-only) so the external Langfuse can reach it.
COPY listen.xml /etc/clickhouse-server/config.d/listen.xml
