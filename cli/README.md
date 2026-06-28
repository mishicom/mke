# `mke` — CLI de plataforma MKE

Operaciones deterministas de MKE como **programa**, no como prosa que un agente
re-interpreta cada vez. Comandos: `deploy`, `rollout`, `expose`, `dns`, `doctor`,
`ls`. Reemplaza el viejo `scripts/deploy-app.sh` (paths/contexto stale).

## Instalar

```bash
npm install                              # en mke/cli (instala tsx)
ln -s ~/mishicomco/mke/cli/mke ~/.local/bin/mke   # o donde tengas PATH
mke help
```

## Comandos

```bash
# Desplegar una app: build → k3d image import → apply -k overlays/<env> → rollout → doctor
# (el mismo loop cerrado que corre el runner self-hosted). El repo se busca en
# <appsRoot>/<app> (appsRoot = $MKE_APPS_ROOT o ~/mishicomco).
mke deploy polla-futbolera stage
mke deploy travelhabitco prod --deploy travelhabit-backend   # Deployment ≠ id del app

# Reiniciar pods sin rebuild (tag mutable :dev, o reciclar tras cambiar un Secret)
mke rollout omni-whatsapp stage

# Exponer un servicio del HOST (systemd) en <app>-<env>.mishi.com.co
# (crea Service sin selector + Endpoints al gateway docker + ingress + DNS + verifica)
mke expose agents-mishi stage --host-port 8787

# Exponer un servicio del CLUSTER ya existente
mke expose mishi-bank stage --svc mishi-bank:80

# Crear/reparar solo el DNS al tunnel correcto del entorno
mke dns agents-stage.mishi.com.co stage

# Diagnosticar la cadena pública y saber QUÉ capa está rota
mke doctor agents-stage.mishi.com.co

# Inventario de lo publicado (host → servicio) por entorno
mke ls stage
```

`--host <fqdn>` cuando el subdominio ≠ id del app (p.ej. `omni-whatsapp` → `omni`).
`--deploy <nombre>` cuando el Deployment ≠ id del app (p.ej. `travelhabitco` → `travelhabit-backend`).

## Conocimiento horneado (antes se re-diagnosticaba a mano)

Vive en `src/mkeConfig.ts`. Lo no obvio:

- **Un solo cluster en el PC gamer: `k3d-mke-prod`**, con stage y prod como
  **namespaces** del mismo cluster. (El cluster/contexto/tunnel `mke-stage` se
  eliminó por confuso — era legacy y sólo servía un demo.) Aplicar al contexto
  equivocado da `namespaces "stage" not found`.
- **El cluster lo sirve un solo tunnel cloudflared, `mke-prod`**
  (`dde2337f…`, wildcard `*.mishi.com.co → Traefik`); stage y prod usan ese mismo
  tunnel. `mke-local` sirve el cluster del laptop.
- **`cloudflared tunnel route dns <NOMBRE> <host>` puede enrutar al tunnel
  equivocado** (mandó a `lmstudio`). Usar SIEMPRE el UUID + `--overwrite-dns`.

## Diagnóstico de `doctor` (cómo leer la cadena)

`DNS → tunnel cloudflared → Traefik → ingress → backend`

| Síntoma | Capa rota | Fix |
|---|---|---|
| DNS no resuelve | no hay CNAME | `mke expose` (crea DNS+ingress) |
| `530` / cuerpo `1033` | tunnel sin ruta al host | `mke dns <host> <env>` |
| `404` | Traefik sin ingress para el host | `mke expose ...` |
| `200/401/403/302` | sano (backend alcanzable) | — |
| `000` | timeout / inalcanzable | revisar tunnel/servicio |
