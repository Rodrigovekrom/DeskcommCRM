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

/**
 * Pedido da Lupa (11/11): reproduzir o CORTE de verdade. A tabela de atividades tem centenas de cobranças
 * antigas por tarefa; a API devolve só as K primeiras linhas. Com a leitura ANTIGA (todas as linhas pela
 * API, em lotes), a tarefa que fica fora do corte parece "nunca cobrada" e é COBRADA DE NOVO. Com a leitura
 * NOVA (pares distintos no banco), o mesmo caso não repete.
 */
import { rodarEsteira, type DepsDaEsteira, type LigacaoPendente } from "@/lib/esteira/rodada";
import { PADRAO_DA_ESTEIRA, type ConfigDaEsteira } from "@/lib/esteira/config";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";

describe("v1.9.42: o corte do max_rows, reproduzido", () => {
  const K = 1000; // o max_rows padrão do PostgREST
  const AGORA = new Date("2026-11-11T15:00:00Z");
  // 3 tarefas vencidas há dias (os 2 níveis já devidos). A 1ª e a 2ª têm 1.200 cobranças antigas de nível 2
  // cada (o lixo acumulado); a 3ª tem 1 só. Todas JÁ foram cobradas no nível 2: nada deveria ser cobrado.
  const tarefas: LigacaoPendente[] = ["t-a", "t-b", "t-c"].map((id) => ({
    id, lead_id: `l-${id}`, contact_id: null, title: "Ligar (L3)", due_date: "2026-11-05T12:00:00Z", assigned_to: null,
  }));
  const tabela: Array<{ source_id: string; payload: { task_id: string; nivel: number } }> = [
    ...Array.from({ length: 1200 }, () => ({ source_id: "t-a", payload: { task_id: "t-a", nivel: 2 } })),
    ...Array.from({ length: 1200 }, () => ({ source_id: "t-b", payload: { task_id: "t-b", nivel: 2 } })),
    { source_id: "t-c", payload: { task_id: "t-c", nivel: 2 } },
  ];

  /** A leitura ANTIGA (v1.9.19.2 até v1.9.41): todas as linhas pela API, em lotes, com o corte em K. */
  async function cobrancasFeitasAntiga(ids: string[]) {
    const { data } = await buscaEmLotes(ids, async (lote) => ({
      data: tabela.filter((r) => lote.includes(r.source_id)).slice(0, K), // a API corta em K linhas
      error: null,
    }));
    const mapa = new Map<string, Set<number>>();
    for (const r of data) {
      if (!mapa.has(r.payload.task_id)) mapa.set(r.payload.task_id, new Set());
      mapa.get(r.payload.task_id)!.add(r.payload.nivel);
    }
    return mapa;
  }

  function deps(cobrancasFeitas: DepsDaEsteira["cobrancasFeitas"], cobradas: string[]): DepsDaEsteira {
    return {
      agora: () => AGORA,
      leadsAbertos: async () => [],
      passarParaFollowup: async () => ({ ok: false, erro: "não usado" }),
      mover: async () => true,
      comHandoff: async () => new Set(),
      clienteFalouDesde: async () => false,
      ultimoReengajo: async () => null,
      marcarReengajou: async () => {},
      ligacoesJaCriadas: async () => new Map(),
      criarLigacao: async () => true,
      perderSemRetorno: async () => true,
      ligacoesVencidas: async () => tarefas,
      cobrancasFeitas,
      cobrar: async (t, nivel) => {
        cobradas.push(`${t.id}:${nivel}`);
      },
    };
  }
  const cfg: ConfigDaEsteira = {
    ...PADRAO_DA_ESTEIRA,
    funis: {
      entrada: { pipeline_id: "00000000-0000-4000-8000-0000000000e1", horas: 72, etapas_de_compromisso: [] },
      followup: { pipeline_id: "00000000-0000-4000-8000-0000000000f1", fases: [{ ate_dia: 90, etapa_id: "00000000-0000-4000-8000-000000000201" }], etapa_reengajou: "00000000-0000-4000-8000-000000000205" },
    },
  };

  it("com a leitura ANTIGA, a tarefa fora do corte é cobrada DE NOVO (o defeito)", async () => {
    const cobradas: string[] = [];
    await rodarEsteira(cfg, deps(cobrancasFeitasAntiga, cobradas));
    // As 1.000 primeiras linhas são todas da t-a: t-b e t-c ficam de fora e parecem "nunca cobradas".
    expect(cobradas.sort()).toEqual(["t-b:2", "t-c:2"]);
  });

  it("com a leitura NOVA (pares distintos no banco), ninguém é cobrado de novo", async () => {
    // O banco responde o DISTINCT sobre a tabela inteira, sem corte.
    consultas.linhas = [...new Set(tabela.map((r) => `${r.source_id}|${r.payload.nivel}`))].map((k) => {
      const [task_id, nivel] = k.split("|");
      return { task_id: task_id!, nivel: Number(nivel) };
    });
    const nova = depsReaisDaEsteira(admin, ORG, () => AGORA);
    const cobradas: string[] = [];
    await rodarEsteira(cfg, deps((ids) => nova.cobrancasFeitas(ids), cobradas));
    expect(cobradas).toEqual([]);
  });
});
