/**
 * ia.vek v1.9.60 (0644, CRM-489): a chave zero_data_retention do agente não tinha leitor nenhum; sai do default e das
 * linhas com o valor de nascença (false). Esta catraca impede que ela volte sem um leitor de verdade.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const MIG = readFileSync(join(RAIZ, "supabase/migrations/20261117150000_0644_iavek_tira_zero_data_retention.sql"), "utf8");
const BASE = readFileSync(join(RAIZ, "supabase/baseline.sql"), "utf8");

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...arquivos(rel));
    else if (/\.(ts|tsx)$/.test(rel)) out.push(rel);
  }
  return out;
}

describe("v1.9.60 (CRM-489): sem a chave que não fazia nada", () => {
  it("nenhum código do produto lê zero_data_retention", () => {
    const leitores = ["app", "components", "hooks", "lib", "workers"]
      .flatMap(arquivos)
      .filter((f) => readFileSync(join(RAIZ, f), "utf8").includes("zero_data_retention"));
    expect(leitores).toEqual([]);
  });

  it("o default novo não tem a chave e o resto é o da 0097", () => {
    const ini = MIG.lastIndexOf("alter column config set default");
    const def = MIG.slice(ini, MIG.indexOf(";", ini));
    expect(def).not.toContain("zero_data_retention");
    for (const k of ["'temperature', 0.3", "'max_tokens', 1024", "'rag_top_k', 5", "'rag_similarity_threshold', 0.40", "'context_message_window', 20", "'confidence_threshold', 0.55", "'sentiment_threshold', 0.3"]) {
      expect(def).toContain(k);
    }
  });

  it("só tira a chave onde ela vale false (quem ligou de propósito não é tocado)", () => {
    expect(MIG).toMatch(/set config = config - 'zero_data_retention'\s+where config \? 'zero_data_retention'\s+and config->'zero_data_retention' = 'false'::jsonb;/);
  });

  it("o baseline termina com o mesmo bloco da migration", () => {
    const bloco = MIG.slice(MIG.lastIndexOf("alter table public.ai_agents"), MIG.lastIndexOf("notify pgrst"));
    expect(BASE).toContain(bloco.trim());
  });
});
