import { ENVS } from "./mkeConfig.js";
import { run, info, dim, bad } from "./sh.js";

/**
 * Inventario de lo que está expuesto: por cada entorno lista los Ingress
 * (host → servicio) de su namespace. La foto de "qué hay publicado en MKE".
 */
export async function ls(only?: string): Promise<void> {
  const envs = only ? [[only, ENVS[only]] as const] : Object.entries(ENVS);
  for (const [env, spec] of envs) {
    if (!spec) {
      console.log(bad(`entorno desconocido: ${env}`));
      continue;
    }
    console.log(`\n  ${env} ${dim(`(${spec.context}/${spec.namespace})`)}`);
    const r = await run("kubectl", [
      "--context", spec.context, "get", "ingress", "-n", spec.namespace,
      "-o", "jsonpath={range .items[*]}{.metadata.name}{\"\\t\"}{.spec.rules[*].host}{\"\\n\"}{end}",
    ]);
    if (r.code !== 0) {
      console.log(`    ${dim(`(sin acceso: ${r.stderr.split("\n")[0]})`)}`);
      continue;
    }
    const lines = r.stdout.split("\n").filter((l) => l.trim());
    if (!lines.length) {
      console.log(`    ${dim("(ningún ingress)")}`);
      continue;
    }
    for (const line of lines) {
      const [name, ...hosts] = line.split("\t");
      console.log(`    ${info(name)} → ${hosts.join(" ")}`);
    }
  }
  console.log("");
}
