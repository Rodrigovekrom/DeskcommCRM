import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lerPreferenciasDoPipeline, PIPELINE_PADRAO, preferenciasDoPipelineSchema } from "@/lib/iavek/preferencias-de-tela";

/** ia.vek v1.7.9 — a vista do Pipeline por pessoa (só visualização). */
describe("preferências do Pipeline", () => {
  it("valor estranho volta ao padrão, sem quebrar a tela", () => {
    expect(lerPreferenciasDoPipeline(null)).toEqual(PIPELINE_PADRAO);
    expect(lerPreferenciasDoPipeline({ ordem: "nada" })).toEqual(PIPELINE_PADRAO);
    expect(lerPreferenciasDoPipeline({ ordem: "atividade" }).ordem).toBe("atividade");
  });
  it("chave desconhecida é recusada (nada de 'funcao' ou papel pegando carona)", () => {
    expect(preferenciasDoPipelineSchema.safeParse({ ordem: "chegada", funcao: "gerente" }).success).toBe(false);
  });
});

describe("as preferências não moram em interface_settings", () => {
  const rota = readFileSync(join(process.cwd(), "app/api/v1/iavek/preferencias/[tela]/route.ts"), "utf8");
  it("a rota grava em iavek_preferencias_de_tela, pela sessão, com o user_id de quem pede", () => {
    expect(rota).toMatch(/from\("iavek_preferencias_de_tela"\)/);
    expect(rota).not.toMatch(/user_organizations|interface_settings\s*:/);
    expect(rota).toMatch(/user_id: authz\.user\.id/);
    expect(rota).toMatch(/createClient\(\)/);
    expect(rota).not.toMatch(/createAdminClient/);
  });
});

describe("o quadro respeita a vista", () => {
  const quadro = readFileSync(join(process.cwd(), "components/kanban/KanbanBoard.tsx"), "utf8");
  it("ordem por atividade recente, etapas ocultas fora e recolhidas como faixa", () => {
    expect(quadro).toMatch(/ordem === "atividade"/);
    expect(quadro).toMatch(/etapasOcultas\?\.has\(stage\.id\) \? null/);
    expect(quadro).toMatch(/data-etapa-recolhida/);
  });
});
