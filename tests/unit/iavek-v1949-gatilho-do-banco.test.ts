/**
 * ia.vek v1.9.49 (Lupa 052149 e 052220): o GATILHO do CI do banco cobre TODA pasta que as invariantes leem.
 *
 * O furo (v1.9.47): o iavek-banco.yml só rodava com mudança em supabase/ e tests/invariants/, mas as invariantes também
 * VARREM o código (lib, app, components, hooks...). Um push só em lib/ passava sem rodar o banco, e o
 * .from(constante) só apareceu porque o mesmo push mexia em supabase/. Um CI verde porque o teste não rodou tem a
 * mesma cara de um CI verde porque está tudo certo.
 *
 * Este teste é UNITÁRIO de propósito: ele roda em todo push. Se fosse uma invariante, ele mesmo não rodaria nos
 * casos que vigia. Pasta nova lida por uma invariante e fora do `paths` do gatilho = VERMELHO.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const rastreados = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: RAIZ }).split("\n").filter(Boolean);
const topo = new Set(rastreados.map((p) => p.split("/")[0]!));
const existe = (caminho: string) => {
  const c = caminho.split("*")[0]!.replace(/\/$/, "");
  return rastreados.some((t) => t === c || t.startsWith(`${c}/`));
};

/** As pastas do topo do repo que cada invariante LÊ: um caminho "pasta/..." que existe, ou a pasta dada a join/readdirSync/ls-files. */
function pastasLidasPelasInvariantes(): Map<string, Set<string>> {
  const lidas = new Map<string, Set<string>>();
  const anota = (pasta: string, arquivo: string) => {
    if (!lidas.has(pasta)) lidas.set(pasta, new Set());
    lidas.get(pasta)!.add(basename(arquivo));
  };
  for (const arquivo of rastreados.filter((p) => /^tests\/invariants\/.+\.ts$/.test(p))) {
    const texto = readFileSync(arquivo, "utf8");
    for (const m of texto.matchAll(/["'`]([A-Za-z0-9_.-]+)\/([^"'`\s$]+)["'`]/g)) {
      if (topo.has(m[1]!) && existe(`${m[1]}/${m[2]}`)) anota(m[1]!, arquivo);
    }
    for (const m of texto.matchAll(/(?:join\([^)]*?|readdirSync\(|ls-files"[^\]]*?)["'`]([A-Za-z0-9_.-]+)["'`]/g)) {
      if (topo.has(m[1]!)) anota(m[1]!, arquivo);
    }
  }
  return lidas;
}

/** Os `paths` do push do iavek-banco.yml (lidos do texto: a lista entre `paths:` e a próxima chave). */
function caminhosDoGatilho(): string[] {
  const yml = readFileSync(".github/workflows/iavek-banco.yml", "utf8");
  const trecho = yml.slice(yml.indexOf("    paths:"), yml.indexOf("  workflow_dispatch"));
  return [...trecho.matchAll(/^\s*-\s*"([^"]+)"/gm)].map((m) => m[1]!);
}

describe("o gatilho do CI do banco cobre toda pasta que as invariantes leem", () => {
  it("cada pasta lida por uma invariante tem o seu 'pasta/**' no paths do iavek-banco.yml", () => {
    const gatilho = new Set(caminhosDoGatilho());
    const fora = [...pastasLidasPelasInvariantes()]
      .filter(([pasta]) => !gatilho.has(`${pasta}/**`))
      .map(([pasta, quem]) => `${pasta}/** (lida por ${[...quem].slice(0, 3).join(", ")})`);
    expect(fora).toEqual([]);
  });

  it("a varredura acha o que deve: lib, app, components e hooks (os casos do furo e da Lupa)", () => {
    const lidas = pastasLidasPelasInvariantes();
    for (const p of ["lib", "app", "components", "hooks", "supabase"]) expect(lidas.has(p), p).toBe(true);
    // e não confunde nome solto com pasta (ex.: o esquema SQL 'public' ou o comando 'docker')
    expect(lidas.has("public")).toBe(false);
  });

  it("o paths lido do yml é o de verdade (a leitura do texto não ficou vazia)", () => {
    const g = caminhosDoGatilho();
    expect(g).toContain("supabase/**");
    expect(g.length).toBeGreaterThan(5);
  });
});
