#!/usr/bin/env bash
# =============================================================================
#  DEPRECADO — usá el CLI `mke deploy`.
#
#  Este script tenía paths/contexto stale (`k3d-mke`, `../mishi-apps`) que ya no
#  existen. El deploy vive ahora en el CLI, con el conocimiento de plataforma
#  horneado:
#
#      mke deploy <app> <local|stage|prod> [--tag t] [--dir repo] [--deploy name]
#
#  build local → k3d image import → kubectl apply -k k8s/overlays/<env> →
#  rollout → doctor. Ver mke/cli/README.md.
# =============================================================================
set -euo pipefail
echo "✗ deploy-app.sh está deprecado. Usá: mke deploy ${1:-<app>} ${2:-<env>}" >&2
exit 1
