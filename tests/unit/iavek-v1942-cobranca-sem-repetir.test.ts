/**
 * ia.vek v1.9.42 (11/11): a cobrança da ligação atrasada não se repete.
 * Medido na produção: 408.529 cobranças (e o mesmo tanto de avisos na Central) em 886 tarefas, quando a
 * regra é UMA por tarefa e nível. Causa: `cobrancasFeitas` lia todas as atividades pela API, e a resposta
 * era cortada no max_rows do PostgREST; a tarefa fora do corte parecia "nunca cobrada".
 * Agora o banco devolve só os pares distintos (tarefa, nível), sem passar pela API.
 */
import { describe, expect, it, vi } from "vitest";

const consultas = vi.hoisted(() => ({ sql: [] as string[], params: [] as unknown[][], linhas: [] as Array<{ task_id: string; nivel: number }> }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({
    query: async (sql: string, params: unknown[]) => {
      consultas.sql.push(sql);
      consultas.params.push(params);
      return { rows: consultas.linhas };
    },
  }),
}));

import { depsReaisDaEsteira } from "@/lib/esteira/deps-reais";

const ORG = "11111111-1111-4111-8111-111111111111";
// Um cliente supabase que FALHA se for usado para ler as cobranças: a leitura não pode mais ir pela API.
const admin = {
  from: (tabela: string) => {
    if (tabela === "crm_lead_activities") throw new Error("cobrancasFeitas não pode ler pela API (corte do max_rows)");
    throw new Error(`tabela inesperada: ${tabela}`);
  },
} as never;

describe("v1.9.42: cobrancasFeitas pergunta ao banco só os pares distintos", () => {
  it("monta o mapa tarefa → níveis a partir das linhas distintas", async () => {
    consultas.linhas = [
      { task_id: "t1", nivel: 1 },
      { task_id: "t1", nivel: 2 },
      { task_id: "t2", nivel: 1 },
    ];
    const deps = depsReaisDaEsteira(admin, ORG, () => new Date());
    const mapa = await deps.cobrancasFeitas(["t1", "t2", "t3"]);
    expect([...mapa.get("t1")!].sort()).toEqual([1, 2]);
    expect([...mapa.get("t2")!]).toEqual([1]);
    expect(mapa.has("t3")).toBe(false);
  });

  it("a consulta é DISTINCT, filtrada por organização, tipo e as tarefas pedidas, numa ida só", async () => {
    consultas.sql = [];
    consultas.params = [];
    consultas.linhas = [];
    const deps = depsReaisDaEsteira(admin, ORG, () => new Date());
    const ids = Array.from({ length: 886 }, (_, i) => `t${i}`);
    await deps.cobrancasFeitas(ids);
    expect(consultas.sql).toHaveLength(1);
    const sql = consultas.sql[0]!.replace(/\s+/g, " ");
    expect(sql).toMatch(/select distinct source_id::text as task_id, \(payload->>'nivel'\)::int as nivel/);
    expect(sql).toContain("organization_id = $1");
    expect(sql).toContain("type = 'esteira_ligacao_cobrada'");
    expect(sql).toContain("source_id = any($2::uuid[])");
    expect(consultas.params[0]).toEqual([ORG, ids]);
  });

  it("sem tarefas, nem vai ao banco", async () => {
    consultas.sql = [];
    const deps = depsReaisDaEsteira(admin, ORG, () => new Date());
    expect((await deps.cobrancasFeitas([])).size).toBe(0);
    expect(consultas.sql).toHaveLength(0);
  });

  it("erro no banco derruba a rodada (não vira 'ninguém foi cobrado'), e a API não é mais usada", async () => {
    const fonte = (await import("node:fs")).readFileSync("lib/esteira/deps-reais.ts", "utf8");
    const corpo = fonte.slice(fonte.indexOf("async cobrancasFeitas"), fonte.indexOf("async cobrar("));
    expect(corpo).not.toMatch(/catch/);
    expect(corpo).not.toContain("buscaEmLotes");
    expect(corpo).not.toContain(".from(");
  });
});
