import { describe, expect, it } from "vitest";

import { etapaDeEntrada } from "@/lib/leads/etapa-de-entrada";

/**
 * ia.vek v1.8.2 — o lead nasce na etapa de ENTRADA declarada pelo funil
 * (`settings.etapa_de_entrada`), e só sem ela na primeira aberta pela posição.
 */
type Linha = Record<string, unknown>;
function bancoFalso(funil: Linha | null, etapas: Linha[]) {
  return {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      let ordenar = false;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
        order: () => ((ordenar = true), q),
        limit: () => q,
        maybeSingle: async () => {
          if (tabela === "crm_pipelines") return { data: funil };
          let ls = etapas.filter((e) => filtros.every(([c, v]) => c === "organization_id" || c === "pipeline_id" || e[c] === v));
          if (ordenar) ls = [...ls].sort((a, b) => Number(a.position) - Number(b.position));
          return { data: ls[0] ?? null };
        },
      };
      return q;
    },
  } as never;
}
const ETAPAS = [
  { id: "ia", slug: "em-atendimento-ia", position: 1000, is_archived: false, is_won: false, is_lost: false },
  { id: "novo", slug: "novo", position: 2000, is_archived: false, is_won: false, is_lost: false },
  { id: "perdido", slug: "perdido", position: 11000, is_archived: false, is_won: false, is_lost: true },
];

describe("etapa de entrada do lead", () => {
  it("com settings.etapa_de_entrada = 'novo', nasce em Lead novo mesmo com IA responsável primeiro", async () => {
    expect(await etapaDeEntrada(bancoFalso({ settings: { etapa_de_entrada: "novo" } }, ETAPAS), "o", "f")).toBe("novo");
  });
  it("sem a chave, vale a regra antiga (primeira aberta pela posição)", async () => {
    expect(await etapaDeEntrada(bancoFalso({ settings: {} }, ETAPAS), "o", "f")).toBe("ia");
  });
  it("slug que não serve (perda) cai na regra antiga", async () => {
    expect(await etapaDeEntrada(bancoFalso({ settings: { etapa_de_entrada: "perdido" } }, ETAPAS), "o", "f")).toBe("ia");
  });
});
