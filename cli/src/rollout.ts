import { envOrThrow } from "./mkeConfig.js";
import { run, ok, bad, info } from "./sh.js";

/**
 * `rollout restart` + `status` para un Deployment ya desplegado. Útil cuando la
 * imagen es un tag mutable (`:dev`) y querés reiniciar sin rebuild, o reciclar
 * pods tras cambiar un Secret/ConfigMap.
 */
export async function rollout(app: string, env: string, deployName?: string): Promise<void> {
  const spec = envOrThrow(env);
  const name = deployName ?? app;
  console.log(info(`rollout restart deploy/${name} (${spec.context}/${spec.namespace})`));

  const r = await run("kubectl", [
    "--context", spec.context, "-n", spec.namespace,
    "rollout", "restart", `deploy/${name}`,
  ]);
  if (r.code !== 0) {
    console.log(bad(`rollout restart falló: ${r.stderr || r.stdout}`));
    return;
  }

  const status = await run("kubectl", [
    "--context", spec.context, "-n", spec.namespace,
    "rollout", "status", `deploy/${name}`, "--timeout=120s",
  ]);
  if (status.code !== 0) {
    console.log(bad(`rollout no convergió: ${status.stderr || status.stdout}`));
    return;
  }
  console.log(ok(status.stdout.split("\n").pop() ?? "rollout listo"));
}
