import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { lerTudo } from "@/lib/supabase/paginas";

/** Imita o teto do servidor: cada resposta traz no máximo 1000, sem erro. */
const servidor = (total: number) => (de: number, ate: number) => {
  const fim = Math.min(ate + 1, de + 1000, total);
  return Promise.resolve({ data: Array.from({ length: Math.max(0, fim - de) }, (_, i) => de + i), error: null });
};

describe("v1.9.19.2: leitura sem corte", () => {
  it("lê tudo acima do teto do servidor, sem repetir nem perder", async () => {
    const { data, error } = await lerTudo<number>(servidor(2500));
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(new Set(data).size).toBe(2500);
  });
  it("erro de leitura volta como erro, não como lista vazia em silêncio", async () => {
    const r = await lerTudo(() => Promise.resolve({ data: null, error: { message: "caiu" } }));
    expect(r.error?.message).toBe("caiu");
  });
  it.each([
    "app/api/v1/metrics/funil/route.ts",
    "app/api/v1/metrics/lost/route.ts",
    "app/api/v1/iavek/pipeline/painel/route.ts",
    "app/api/v1/iavek/meus-numeros/route.ts",
    "app/api/v1/cron/risk-watcher/route.ts",
    "app/api/v1/leads/proposals/route.ts",
    "lib/leads/risk-seed.ts",
    "lib/leads/previsao.ts",
    "lib/operacao/marcadores-e-time.ts",
    "lib/esteira/deps-reais.ts",
  ])("%s lê por páginas", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(/lerTudo\(/);
  });
  it("o uso da plataforma não conta por linhas devolvidas", () => {
    const s = readFileSync("app/api/v1/admin/usage/route.ts", "utf8");
    expect(s).not.toMatch(/\.select\("organization_id"\)/);
    expect((s.match(/lerTudo</g) ?? []).length).toBe(3);
    expect((s.match(/head: true/g) ?? []).length).toBe(2);
  });
  it("nenhuma destas leituras volta a pedir mais que o teto do servidor", () => {
    for (const r of [
      "ai/usage", "ai/evolution", "audit/export", "contacts/duplicates", "iavek/meu-dia",
      "iavek/obrigatorios/incompletos", "iavek/padrao/fora",
    ]) {
      const s = readFileSync(`app/api/v1/${r}/route.ts`, "utf8");
      expect(s, r).toMatch(/lerTudo</);
      expect(s, r).not.toMatch(/\.limit\((TETO_DE_VARREDURA|1000|10_000|50_000|100_000)/);
    }
  });
  it("o selo de campos pede em lotes, nunca a loja inteira numa URL", () => {
    const s = readFileSync("components/iavek/CamposObrigatorios.tsx", "utf8");
    expect(s).toMatch(/IDS_POR_PEDIDO = 100/);
    expect(s).not.toMatch(/ids=\$\{chave\}/);
  });
  it("a esteira não trata erro como 'ninguém cobrado' nem 'nenhuma ligação'", () => {
    const s = readFileSync("lib/esteira/deps-reais.ts", "utf8");
    expect(s.match(/buscaEmLotes\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(s).not.toMatch(/\.limit\(500\)/);
  });
});
