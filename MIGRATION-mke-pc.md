# Plan: renombrar el cluster del PC gamer a `mke-pc`

> **Estado: PLAN, no ejecutado.** No correr ningún paso de la Fase 3 hasta tener
> verdes las Fases 0 y 1 (backups a Google Drive + ensayo real de restore).
> Decisión (2026-06-28): hacemos esto sólo cuando la migración esté *probada*.

## Por qué duele (y por qué hay plan, no `rename`)

`k3d` **no tiene `cluster rename`**. El nombre está horneado en los contenedores
docker (`k3d-mke-prod-server-0`, `-serverlb`), la red docker (`k3d-mke-prod`), los
nodos y el contexto kubectl. Renombrar = **borrar y recrear** el cluster. Y
`k3d cluster delete` **borra los volúmenes docker** → se pierde TODA la data en
PVCs salvo que se haya respaldado y se restaure:

- `databases/postgres-0` (prod) y `databases-dev/postgres-0` (dev/stage)
- `storage/minio` (prod) y `storage-stage/minio` (stage)

Es producción 24/7. Por eso: backups probados primero, ensayo en un cluster
desechable después, y recién entonces el cutover.

## Lo que SÍ se conserva sin tocar

- **El tunnel cloudflared `mke-prod` (`dde2337f-7e0a-47b7-aec0-dfc9b10539af`)** y
  por ende **todos los CNAME `*.mishi.com.co`**. El tunnel corre in-cluster (ns
  `cloudflare`) a partir de un Secret con las credenciales del tunnel; si
  recreamos ese Secret con el mismo `dde2337f….json`, el nuevo cluster levanta el
  *mismo* tunnel y el DNS no se entera. **No hay que tocar DNS.**
- Los repos de las apps y sus overlays kustomize.

## Lo que cambia (y hay que actualizar)

- **Contexto/cluster:** `k3d-mke-prod` → `k3d-mke-pc`. Editar `cli/src/mkeConfig.ts`
  (`context` y `cluster` de stage y prod).
- **IP del gateway docker** (`hostGatewayIp`, hoy `172.20.0.1`): la red nueva puede
  asignar otra. Verificar con `docker network inspect k3d-mke-pc` y actualizar
  `mkeConfig.ts`. Afecta `mke expose --host-port` (Service+Endpoints al gateway).
- Cualquier doc/skill que diga `mke-prod` como nombre de cluster (no como ns).

---

## Fase 0 — Backups a Google Drive (PRERREQUISITO duro)

Hoy **no hay backups implementados** (ver memoria `infra-roadmap`). Sin esto, la
migración es inaceptable. Construir y dejar corriendo:

1. **rclone** con remote a Google Drive (cuenta de Mishi). Guardar el token con
   `mishi-secret`.
2. **Postgres:** `pg_dump` por cada instancia (prod + dev) →
   `kubectl exec postgres-0 -- pg_dumpall` (o `pg_dump` por BD) → gzip → rclone a
   `gdrive:mke-backups/postgres/<fecha>/`.
3. **MinIO:** `mc mirror` de cada instancia (prod + stage) a un bucket/carpeta de
   respaldo, y de ahí rclone a `gdrive:mke-backups/minio/<fecha>/` (o `rclone
   sync` directo del PVC montado).
4. **Job programado** en el PC gamer (CronJob k8s o systemd timer) + verificación
   de que el archivo llega a Drive. **Restore probado** (no sólo el dump).

Salida de Fase 0: un backup completo en Drive **y** un restore exitoso demostrado.

## Fase 1 — Ensayo en cluster desechable (PRERREQUISITO duro)

Probar el procedimiento completo **sin tocar prod**:

1. Crear `k3d cluster create mke-pc-test` con la misma topología (1 server,
   loadbalancer, traefik, mismos puertos/network donde no choque con prod).
2. Restaurar los backups de Fase 0 en `mke-pc-test`:
   - postgres: crear los StatefulSets, esperar `postgres-0`, `psql < dump`.
   - minio: levantar minio, `mc mirror` de vuelta los buckets.
3. `mke deploy <app> stage --dir <repo>` apuntando el contexto a `mke-pc-test`
   para 2-3 apps con estado (omni, bank) y verificar que **leen su data
   restaurada** (login, historial, archivos en minio).
4. Levantar un cloudflared in-cluster con un tunnel de prueba y `mke doctor`.

Salida de Fase 1: checklist verde de integridad de datos + apps arrancando contra
la data restaurada. Documentar tiempos (= ventana de downtime esperada).

## Fase 2 — Preparar el cutover

1. Manifiestos del cluster nuevo versionados en `mke/clusters/mke-pc/` (config
   k3d, ns `cloudflare` con el Secret del tunnel `dde2337f`, traefik, ns de
   plataforma).
2. Branch del CLI con `mkeConfig.ts` ya apuntando a `k3d-mke-pc` + nueva
   `hostGatewayIp` (placeholder, se confirma tras crear la red).
3. Anuncio de ventana de mantenimiento (downtime real durante el cutover).

## Fase 3 — Cutover (ejecutar sólo con 0 y 1 verdes)

1. **Backup final en caliente** (Fase 0) inmediatamente antes. Confirmar en Drive.
2. Escalar a 0 las apps con escritura (postgres clients) para un dump consistente;
   dump final de postgres + mirror final de minio.
3. `k3d cluster delete mke-prod`.
4. `k3d cluster create mke-pc` (topología de Fase 2). Confirmar `hostGatewayIp` con
   `docker network inspect k3d-mke-pc` y fijarla en `mkeConfig.ts`.
5. Aplicar plataforma: ns `cloudflare` + Secret del tunnel `dde2337f` (mismo
   tunnel → DNS intacto), traefik, `databases`, `databases-dev`, `storage`,
   `storage-stage`.
6. **Restore** de postgres y minio desde el backup final.
7. `mke deploy <app> prod` y `mke deploy <app> stage` para cada app.
8. `mke ls prod && mke ls stage` y `mke doctor <host>` de los hosts críticos.
9. Merge del branch del CLI (contexto/IP nuevos). Actualizar skill `mke-deploy` y
   memorias que nombren `mke-prod` como cluster.

## Rollback

Si algo falla durante el cutover: el cluster viejo ya no existe, así que el
rollback es **recrear `mke-pc` (o `mke-prod`) y restaurar el último backup bueno**.
De ahí que Fase 0/1 sean no negociables: el backup *es* el plan de rollback.
