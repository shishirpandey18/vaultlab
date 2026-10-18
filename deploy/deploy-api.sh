#!/usr/bin/env bash
# Day 14: copy the API from this checkout to /opt/vaultlab/server, install its packages, restart the service.
# Run from anywhere:  ./deploy/deploy-api.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Copying server/ to /opt/vaultlab/server (no .env, no node_modules, no cookie jars)"
sudo rsync -a --delete --chown=root:root \
  --exclude node_modules --exclude .env --exclude '.env.*' --exclude '*.txt' \
  server/ /opt/vaultlab/server/

echo "== Installing production packages"
cd /opt/vaultlab/server
sudo npm ci --omit=dev --no-audit --no-fund

if systemctl cat vaultlab-api >/dev/null 2>&1; then
  echo "== Restarting the service"
  sudo systemctl restart vaultlab-api
  sleep 2
  systemctl is-active vaultlab-api
else
  echo "== vaultlab-api.service isn't installed yet: nothing to restart"
fi
