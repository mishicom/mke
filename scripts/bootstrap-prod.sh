#!/usr/bin/env bash
# =============================================================================
#  bootstrap-prod.sh — levanta el clúster Mishi-Prod en la pc home (WSL).
#
#  Un solo cluster con namespaces stage + prod. Cambia solo configuración,
#  nunca código (overlays Kustomize).
#
#  Idempotente: se puede correr varias veces. Crea (si no existen):
#    1. clúster k3d "mke-prod"  (contexto kubectl: k3d-mke-prod)
#    2. Traefik (Helm) en ns "ingress", service ClusterIP (modelo tunnel-only)
#    3. túnel Cloudflare "mke-prod" (cloudflared CLI) + Secret tunnel-credentials
#    4. cloudflared in-cluster (clusters/prod/cloudflared)
#    5. rutas DNS stage y prod -> túnel mke-prod
#
#  Prerrequisitos en la pc home:
#    - WSL con systemd, Docker, k3d, helm v4, kubectl, cloudflared
#    - cloudflared YA autenticado (~/.cloudflared/cert.pem)
#  NOTA: NO toca el túnel de ai.mishi.com.co (LM Studio); convive aparte.
# =============================================================================
set -euo pipefail

CLUSTER="mke-prod"
CONTEXT="k3d-${CLUSTER}"
TUNNEL="mke-prod"
HOSTS=("hello-stage.mishi.com.co" "hello.mishi.com.co")
CF_DIR="${HOME}/.cloudflared"

MKE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_DIR="${MKE_ROOT}/clusters/prod"

say() { echo -e "\n▶ $*"; }

# --- 1. Clúster k3d ----------------------------------------------------------
if k3d cluster list 2>/dev/null | grep -qw "${CLUSTER}"; then
  say "Clúster k3d '${CLUSTER}' ya existe — lo arranco si está parado."
  k3d cluster start "${CLUSTER}" || true
else
  say "Creando clúster k3d '${CLUSTER}' (1 nodo, sin Traefik embebido)."
  k3d cluster create "${CLUSTER}" \
    --servers 1 \
    --k3s-arg "--disable=traefik@server:0" \
    --wait
fi
kubectl config use-context "${CONTEXT}" >/dev/null

# --- 2. Traefik (Helm v4) ----------------------------------------------------
say "Instalando/actualizando Traefik en ns 'ingress'."
helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo update traefik >/dev/null
helm upgrade --install traefik traefik/traefik \
  --namespace ingress --create-namespace \
  --kube-context "${CONTEXT}" \
  -f "${PROD_DIR}/traefik-values.yaml" \
  --wait

# --- 3. Túnel Cloudflare (CLI, locally-managed) ------------------------------
if [[ ! -f "${CF_DIR}/cert.pem" ]]; then
  echo "✗ Falta ${CF_DIR}/cert.pem. Ejecuta primero: cloudflared tunnel login" >&2
  exit 1
fi

if cloudflared tunnel list 2>/dev/null | grep -qw "${TUNNEL}"; then
  say "Túnel '${TUNNEL}' ya existe."
else
  say "Creando túnel Cloudflare '${TUNNEL}'."
  cloudflared tunnel create "${TUNNEL}"
fi

TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk -v t="${TUNNEL}" '$2==t {print $1}')"
CREDS_FILE="${CF_DIR}/${TUNNEL_ID}.json"
[[ -f "${CREDS_FILE}" ]] || { echo "✗ No encuentro credenciales: ${CREDS_FILE}" >&2; exit 1; }

# --- 4. Secret + cloudflared in-cluster --------------------------------------
say "Aplicando namespace 'cloudflare' + Secret tunnel-credentials."
kubectl --context "${CONTEXT}" create namespace cloudflare \
  --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -
kubectl --context "${CONTEXT}" -n cloudflare create secret generic tunnel-credentials \
  --from-file=credentials.json="${CREDS_FILE}" \
  --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -

say "Desplegando cloudflared in-cluster."
kubectl --context "${CONTEXT}" apply -k "${PROD_DIR}/cloudflared"
kubectl --context "${CONTEXT}" -n cloudflare rollout status deploy/cloudflared --timeout=120s

# --- 5. DNS por hostname (convive con ai.mishi.com.co) -----------------------
for h in "${HOSTS[@]}"; do
  say "Ruta DNS ${h} -> túnel ${TUNNEL}."
  cloudflared tunnel route dns "${TUNNEL}" "${h}" || \
    echo "  (ya existía o requiere revisión manual)"
done

cat <<EOF

✓ Mishi-Prod listo.
   Contexto:   ${CONTEXT}
   Túnel:      ${TUNNEL} (${TUNNEL_ID})
   Hostnames:  ${HOSTS[*]}
   Overlays:   stage (namespace stage), prod (namespace prod)

Siguiente: desplegar hello-mishi a prod
   KUBE_CONTEXT=${CONTEXT} REGISTRY=ghcr.io/OWNER \\
     scripts/deploy-app.sh hello-mishi prod v0.1.0

Verifica:
   kubectl --context ${CONTEXT} -n cloudflare get pods
   curl -I https://hello.mishi.com.co
EOF
