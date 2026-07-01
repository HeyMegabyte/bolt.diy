#!/bin/bash
set -e
echo "[start.sh] Initializing Checkmate..."
# Start MongoDB
mongod --dbpath /data/db --bind_ip 127.0.0.1 --quiet --fork --logpath /var/log/mongodb/mongod.log
# Start backend
cd /app && node dist/index.js &
BACKEND_PID=$!
# Start nginx
nginx -g "daemon off;" &
NGINX_PID=$!
# Wait for either to exit
wait -n $BACKEND_PID $NGINX_PID
