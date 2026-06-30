#!/bin/bash
# Wrapper around Appsmith's entrypoint for Fly Firecracker VMs.
# Creates /dev/shm if missing (PostgreSQL shared memory requirement).
# Logs boot output to /appsmith-stacks/boot.log for diagnosis.
set -e

BOOT_LOG="/appsmith-stacks/boot.log"

{
  echo "=== Appsmith boot $(date -u) ==="
  echo "Kernel: $(uname -r)"
  echo "Memory: $(free -m 2>/dev/null | head -2 || true)"

  # Create /dev/shm if missing (Firecracker VMs may not have it)
  if [ ! -d /dev/shm ] || [ "$(stat -f -c '%t' /dev/shm 2>/dev/null || stat -c '%t' /dev/shm 2>/dev/null || echo '0')" = "0" ]; then
    echo "Creating /dev/shm (missing on this host)..."
    mkdir -p /dev/shm
    mount -t tmpfs -o size=256M tmpfs /dev/shm 2>/dev/null || {
      echo "WARNING: Could not mount /dev/shm — PostgreSQL may fail"
    }
    echo "/dev/shm created: $(df -h /dev/shm 2>/dev/null || echo 'n/a')"
  else
    echo "/dev/shm exists: $(df -h /dev/shm 2>/dev/null || echo 'n/a')"
  fi

  echo "Running Appsmith entrypoint..."
} >> "$BOOT_LOG" 2>&1

exec /opt/appsmith/entrypoint.sh "$@"
