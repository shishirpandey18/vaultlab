#!/usr/bin/env bash
# Day 14: run a command in /opt/vaultlab/server as the vaultlab user, with the service's settings.
# Example:  ./deploy/vaultlab-run.sh node scripts/check-vault.js
set -euo pipefail
sudo bash -c 'set -a; . /etc/vaultlab/api.env; set +a; cd /opt/vaultlab/server && exec runuser -u vaultlab -- "$@"' _ "$@"
