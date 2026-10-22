#!/usr/bin/env bash
# Pull the latest code, rebuild, restart, and clean up old images.
set -euo pipefail
cd "$(dirname "$0")/.."
PROFILE=()
docker compose ps --services 2>/dev/null | grep -qx caddy && PROFILE=(--profile caddy)
git pull --ff-only
export COMPOSE_PARALLEL_LIMIT=1
docker compose "${PROFILE[@]}" build
docker compose "${PROFILE[@]}" up -d
docker image prune -f >/dev/null
docker builder prune -f --keep-storage 2GB >/dev/null 2>&1 || true
docker compose "${PROFILE[@]}" ps
