#!/bin/sh
# Diagnostic entrypoint: CF Containers give NO stdout visibility for a distroless image, so
# when /unkey crash-exits before binding :7070 (→ Worker 1101) we can't see why. Run unkey in
# the FOREGROUND; if it exits, fall through to a busybox httpd that serves the captured log on
# :7070 — then `curl https://api.projectsites.dev/unkey.log` reveals the exact boot error.
# Healthy case: unkey holds :7070 forever and httpd never starts (real API serves). Once Unkey
# is confirmed healthy, revert to the plain `FROM ghcr.io/unkeyed/unkey` image.
echo "[diag] $(date 2>/dev/null) starting /unkey (UNKEY_CONFIG=$UNKEY_CONFIG)" >/tmp/unkey.log
/unkey >>/tmp/unkey.log 2>&1
code=$?
echo "[diag] /unkey EXITED code=$code — serving log on :7070" >>/tmp/unkey.log
exec busybox httpd -f -p 7070 -h /tmp
