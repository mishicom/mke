import { existsSync } from "node:fs";
import { join } from "node:path";
import { appsRoot, envOrThrow, hostFor } from "./mkeConfig.js";
import { run, ok, bad, info, dim } from "./sh.js";
import { doctor } from "./doctor.js";

export interface DeployOpts {
  /** directorio del repo del app (default: <appsRoot>/<app>) */
  dir?: string;
  /** tag mutable de la imagen (default: dev — lo referencia el overlay) */
  tag?: string;
  /** nombre del Deployment si difiere del id del app (ej. travelhabitco→travelhabit-backend) */
  deploy?: string;
  /** override del host público para el doctor final */
  host?: string;
}

/**
 * build local → `k3d image import` (sin GHCR) → `kubectl apply -k overlays/<env>`
 * → `rollout status` → doctor. Mismo loop cerrado que corre el runner self-hosted.
 */
export async function deploy(app: string, env: string, opts: DeployOpts): Promise<void> {
  const spec = envOrThrow(env);
  const tag = opts.tag ?? "dev";
  const appDir = opts.dir ?? join(appsRoot(), app);
  const overlay = join(appDir, "k8s", "overlays", env);
  const image = `${app}:${tag}`;
  const deployName = opts.deploy ?? app;

  if (!existsSync(appDir)) throw new Error(`no existe el repo del app: ${appDir} (pasá --dir o exportá MKE_APPS_ROOT)`);
  if (!existsSync(overlay)) throw new Error(`no existe el overlay: ${overlay}`);

  // 1) build (docker en WSL puede pedir sudo; probamos directo, sin sudo)
  console.log(info(`build ${dim(image)} desde ${dim(appDir)}`));
  const build = await run("docker", ["build", "-t", image, appDir]);
  if (build.code !== 0) {
    console.log(bad(`docker build falló: ${build.stderr || build.stdout}`));
    return;
  }
  console.log(ok("imagen construida"));

  // 2) import directo al cluster k3d (sin pasar por GHCR)
  console.log(info(`k3d image import ${dim(image)} → ${spec.cluster}`));
  const imp = await run("k3d", ["image", "import", image, "-c", spec.cluster]);
  if (imp.code !== 0) {
    console.log(bad(`k3d image import falló: ${imp.stderr || imp.stdout}`));
    return;
  }
  console.log(ok("imagen importada"));

  // 3) apply del overlay
  console.log(info(`kubectl apply -k ${dim(overlay)} (${spec.context}/${spec.namespace})`));
  const apply = await run("kubectl", ["--context", spec.context, "apply", "-k", overlay]);
  if (apply.code !== 0) {
    console.log(bad(`apply falló: ${apply.stderr || apply.stdout}`));
    return;
  }
  console.log(ok(apply.stdout.split("\n").join(" · ")));

  // 4) si la imagen es un tag mutable, el apply no cambia el spec → forzá el restart
  console.log(info(`rollout restart deploy/${deployName}`));
  await run("kubectl", ["--context", spec.context, "-n", spec.namespace, "rollout", "restart", `deploy/${deployName}`]);

  // 5) esperá el rollout
  const status = await run("kubectl", [
    "--context", spec.context, "-n", spec.namespace,
    "rollout", "status", `deploy/${deployName}`, "--timeout=120s",
  ]);
  if (status.code !== 0) {
    console.log(bad(`rollout no convergió: ${status.stderr || status.stdout}`));
    return;
  }
  console.log(ok(status.stdout.split("\n").pop() ?? "rollout listo"));

  // 6) verificá la cadena pública
  const host = opts.host ?? hostFor(app, env);
  await doctor(host, "/health");
}
