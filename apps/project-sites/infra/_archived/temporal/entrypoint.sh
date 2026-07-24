#!/usr/bin/env bash
set -eu

# Replace placeholders in the config with real values from env vars
sed -i "s/PLACEHOLDER_HOST/${DB_HOST}/g" /etc/temporal/config/docker.yaml
sed -i "s/PLACEHOLDER_USER/${DB_USER}/g" /etc/temporal/config/docker.yaml
sed -i "s/PLACEHOLDER_PASSWORD/${DB_PASSWORD}/g" /etc/temporal/config/docker.yaml

echo "Starting Temporal server..."
exec temporal-server --root /etc/temporal --env docker start
