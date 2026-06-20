#!/usr/bin/env bash
# Slim every canonical custom Docker image with SlimToolkit (`slim build`) and
# smoke-test that it still works. See ~/.agentskills/rules/docker-slim-all-containers.md
#
#   bash scripts/slim-containers.sh          # build → slim → smoke-test → size deltas
#   bash scripts/slim-containers.sh --check  # CI: non-zero exit if any smoke test fails
#
# CRITICAL: the two Cloudflare Containers (./Dockerfile, ./containers/app-runtime/
# Dockerfile) are rebuilt by CF FROM the Dockerfile on `wrangler deploy` — they do
# NOT consume a local .slim image. For those, `slim build` is run in MEASURE mode
# (report unused files; fold deletions back into the Dockerfile by hand). Only
# push-deployed / local / CI images ship slim.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PS="$REPO_ROOT/apps/project-sites"
CHECK_MODE="${1:-}"
FAILS=0

log() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

ensureSlim() {
  if ! command -v slim >/dev/null 2>&1; then
    log "Installing SlimToolkit (slim)…"
    if command -v brew >/dev/null 2>&1; then
      brew install docker-slim
    else curl -sL https://raw.githubusercontent.com/slimtoolkit/slim/master/scripts/install-slim.sh | sudo -E bash -; fi
  fi
  docker info >/dev/null 2>&1 || {
    echo "Docker daemon not running — start Docker Desktop first."
    exit 1
  }
}

# name | dockerfile (relative to PS) | build-context | cf-managed(1/0) | smoke-cmd
# CF-managed images are MEASURE-only; others build+slim+smoke and could be pushed.
CONTAINERS=(
  "build-container|$REPO_ROOT/Dockerfile|$REPO_ROOT|1|node --version"
  "app-runtime|$PS/containers/app-runtime/Dockerfile|$PS/containers/app-runtime|1|node --version"
  "ps-container|$PS/container/Dockerfile|$PS/container|0|node --version"
  "voice-browse|$PS/Dockerfile.voice-browse|$PS|0|node --version"
)

# ── Self-host stack (registry images → SHIP-slim) — see docs/SUBDOMAIN_MAP.md ──
# subdomain | image | http-probe path (or "" → exec /bin/true). These are pulled
# (no local Dockerfile) then `slim build`'d → the .slim tag is what gets pushed/run.
# Run with `--registry`. Each needs its real env/config to boot the probe cleanly;
# under-covered probes → add `--include-path` per service (a failing smoke is NOT shipped).
REGISTRY_IMAGES=(
  "llm.megabyte.space|ghcr.io/berriai/litellm:main-latest|/health/liveliness"
  "langfuse.megabyte.space|langfuse/langfuse:latest|/api/public/health"
  "chat.megabyte.space|ghcr.io/open-webui/open-webui:main|/health"
  "inngest.megabyte.space|inngest/inngest:latest|/health"
  "n8n.megabyte.space|n8nio/n8n:latest|/healthz"
  "secrets.megabyte.space|infisical/infisical:latest|/api/status"
  "vault.megabyte.space|vaultwarden/server:latest|/alive"
  "db.megabyte.space|nocodb/nocodb:latest|/api/v1/health"
  "pb.megabyte.space|spectado/pocketbase:latest|/api/health"
  "wiki.megabyte.space|outlinewiki/outline:latest|/_health"
  "notes.megabyte.space|neosmemo/memos:stable|/healthz"
  "analytics.megabyte.space|ghcr.io/umami-software/umami:postgresql-latest|/api/heartbeat"
  "news.megabyte.space|listmonk/listmonk:latest|/api/health"
  "status.megabyte.space|louislam/uptime-kuma:1|/"
)

slimRegistryOne() {
  local sub="$1" image="$2" probe="$3" name="${1%%.*}"
  log "[$sub] pull $image"
  docker pull "$image" || {
    echo "  pull failed $image"
    FAILS=$((FAILS + 1))
    return 0
  }
  log "[$sub] slim build (SHIP)"
  local args=(build --target "$image" --tag "$sub:slim" --continue-after 8)
  if [ -n "$probe" ]; then args+=(--http-probe --http-probe-cmd "$probe"); else args+=(--exec "/bin/true"); fi
  if ! slim "${args[@]}" 2>&1 | tail -6; then
    echo "  ✗ slim failed for $sub — boot it with real env + add --include-path, re-slim (do NOT ship a broken slim)"
    FAILS=$((FAILS + 1))
    return 0
  fi
  printf '  size: '
  docker images "$sub" --format '{{.Tag}}={{.Size}}' | tr '\n' ' '
  echo
  echo "  SHIP: push $sub:slim to the registry / Fly app that backs $sub"
}

slimOne() {
  local name="$1" dfile="$2" ctx="$3" cf="$4" smoke="$5"
  [ -f "$dfile" ] || {
    echo "skip $name — $dfile missing"
    return 0
  }
  log "[$name] build fat image"
  docker build -t "ps-$name:fat" -f "$dfile" "$ctx"

  log "[$name] slim build (exec-probe: $smoke)"
  if ! slim build --exec "$smoke" --target "ps-$name:fat" --tag "ps-$name:slim" --continue-after 1 2>&1 | tail -8; then
    echo "  slim build failed for $name"
    FAILS=$((FAILS + 1))
    return 0
  fi

  log "[$name] smoke-test the SLIM image"
  if docker run --rm "ps-$name:slim" sh -c "$smoke" >/dev/null 2>&1; then
    echo "  ✓ slim image functional"
  else
    echo "  ✗ slim image BROKE the smoke test — keep the fat image, add --include-path and re-slim"
    FAILS=$((FAILS + 1))
  fi

  printf '  size: '
  docker images "ps-$name" --format '{{.Tag}}={{.Size}}' | tr '\n' ' '
  echo
  [ "$cf" = "1" ] && echo "  NOTE: CF-managed — fold the slim report's deletions into $dfile (CF rebuilds from Dockerfile)."
}

ensureSlim
for c in "${CONTAINERS[@]}"; do
  IFS='|' read -r n d x cf s <<<"$c"
  slimOne "$n" "$d" "$x" "$cf" "$s"
done

# Self-host stack pull-slim only on explicit --registry (default/CI skips the multi-GB pulls).
if [ "$CHECK_MODE" = "--registry" ]; then
  log "Self-host registry stack (SHIP-slim) — see docs/SUBDOMAIN_MAP.md"
  for r in "${REGISTRY_IMAGES[@]}"; do
    IFS='|' read -r sub img probe <<<"$r"
    slimRegistryOne "$sub" "$img" "$probe"
  done
fi

log "Done — $FAILS functional failure(s)"
if { [ "$CHECK_MODE" = "--check" ] || [ "$CHECK_MODE" = "--registry" ]; } && [ "$FAILS" -gt 0 ]; then exit 1; fi
