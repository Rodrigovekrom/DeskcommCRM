/**
 * ia.vek v1.9.62 (CRM-497, D4 1A/2A do Rodrigo): quem PASSA o lead resolve as tarefas abertas dele antes.
 *  - POST /api/v1/iavek/passagem com tarefa de pessoa aberta: 409 `tarefas_abertas` com a lista, e NADA muda (nem dono);
 *    sem tarefa de pessoa aberta: passa, e as automáticas fecham depois da troca de dono;
 *  - /api/v1/iavek/passagem/tarefas: `feita`, `excluir` (CANCELA com 'excluida_ao_passar', não apaga) e `voltar`; a
 *    tarefa tem de ser DESTE lead (o filtro vai na escrita); quem não cuida do lead nem passa por função recebe 404.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "22222222-2222-4222-8222-222222222222";
const VENDEDOR = "33333333-3333-4333-8333-333333333333";
const LEAD = "44444444-4444-4444-8444-444444444444";
const TAREFA = "55555555-5555-4555-8555-555555555555";

let abertas: Array<Record<string, unknown>>;
let donosMudados: number;
let automaticasFechadas: string[];
let escritas: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }>;
let atividades: Array<Record<string, unknown>>;
let funcao: string;
let papel: string;
let lead: Record<string, unknown>;
let tarefaVolta: boolean;

function banco() {
  return {
    from(tabela: string) {
      let valores: Record<string, unknown> | null = null;
      const filtros: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "is", "not", "order", "limit", "gte", "neq"]) q[m] = () => q;
      q.eq = (k: string, v: unknown) => {
        filtros.push([k, v]);
        return q;
      };
      q.in = (k: string, v: unknown) => {
        filtros.push([k, v]);
        return q;
      };
      q.update = (v: Record<string, unknown>) => {
        valores = v;
        if (tabela === "crm_tasks") escritas.push({ valores: v, filtros });
        return q;
      };
      q.insert = async (v: Record<string, unknown>) => {
        if (tabela === "crm_lead_activities") atividades.push(v);
        return { error: null };
      };
      q.maybeSingle = async () => {
        if (tabela === "crm_tasks" && valores) {
          return { data: tarefaVolta ? { id: TAREFA, title: "Retornar", due_date: null, priority: "high", lead_id: LEAD, contact_id: null } : null, error: null };
        }
        if (tabela === "organizations") return { data: { settings: {} }, error: null };
        return { data: null, error: null };
      };
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

function mocks() {
  vi.resetModules();
  vi.doMock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
  vi.doMock("@/lib/auth/require-role", () => ({
    requireRole: async () => ({
      ok: true,
      org: { orgId: ORG, role: papel, interface_settings: { funcao } },
      user: { id: EU, idioma: "pt-BR" },
    }),
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco() }));
  vi.doMock("@/lib/audit", () => ({ audit: async () => undefined }));
  vi.doMock("@/lib/iavek/perfil-da-empresa", () => ({
    ehLojaDeCarros: () => true,
    lerPerfilDaEmpresa: () => ({ modo_agendamento: false }),
  }));
  vi.doMock("@/lib/iavek/sdr-marca-direto", () => ({ vendedoresDaLoja: async () => [{ id: VENDEDOR, nome: "V" }] }));
  vi.doMock("@/lib/iavek/passagem-servidor", async (orig) => ({
    ...(await orig<typeof import("@/lib/iavek/passagem-servidor")>()),
    leadVisivelPelaSessao: async () => true,
    lerLeadDaPassagem: async () => lead,
    tarefasDePessoaAbertas: async () => abertas,
    fecharAutomaticasDaPassagem: async (_a: unknown, _o: string, id: string) => {
      automaticasFechadas.push(id);
    },
    anotarCampos: async () => ({ ...CAMPOS }),
    mudarDono: async () => {
      donosMudados += 1;
      return true;
    },
    moverParaAEtapaDaPassagem: async () => true,
    passarAConversa: async () => undefined,
    registrarPassagem: async () => undefined,
    avisoDaPassagem: async () => undefined,
    nomeDoCliente: async () => null,
  }));
  vi.doMock("@/lib/tarefas/criar-tarefa", () => ({ criarTarefaInterna: async () => ({ ok: true, tarefa_id: "t", assigned_to: VENDEDOR }) }));
}

// os 7 campos da passagem preenchidos (a passagem por "negociar" exige)
const CAMPOS = {
  carro_de_interesse: "Onix",
  forma_de_pagamento: "financiamento",
  entrada: "10000",
  tem_troca: "nao",
  nome_completo: "Cliente",
  cidade: "SP",
  melhor_horario: "manha",
};

beforeEach(() => {
  abertas = [];
  donosMudados = 0;
  automaticasFechadas = [];
  escritas = [];
  atividades = [];
  funcao = "sdr";
  papel = "agent";
  tarefaVolta = true;
  lead = {
    id: LEAD,
    organization_id: ORG,
    pipeline_id: "entrada",
    stage_id: "s",
    contact_id: null,
    owner_user_id: EU,
    sdr_user_id: EU,
    status: "open",
    created_at: new Date().toISOString(),
    custom_fields: { ...CAMPOS },
    source_metadata: {},
  };
  mocks();
});

async function passar(corpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/iavek/passagem/route");
  return POST(new NextRequest("http://x/api/v1/iavek/passagem", { method: "POST", body: JSON.stringify({ lead_id: LEAD, ...corpo }) }));
}

const TROCA = { tipo: "trocar_vendedor", vendedor_id: VENDEDOR, motivo: "Cliente pediu outro vendedor" };

describe("v1.9.62 (D4 1A): a passagem por pessoa exige as tarefas resolvidas", () => {
  it("com tarefa de pessoa aberta: 409 tarefas_abertas com a lista, e o dono NÃO muda", async () => {
    abertas = [{ id: TAREFA, title: "Retornar", assigned_to: VENDEDOR, due_date: null, status: "pending" }];
    const res = await passar(TROCA);
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { error: { code: string; details: { tarefas: Array<{ id: string }> } } };
    expect(corpo.error.code).toBe("tarefas_abertas");
    expect(corpo.error.details.tarefas.map((x) => x.id)).toEqual([TAREFA]);
    expect(donosMudados).toBe(0);
    expect(automaticasFechadas).toEqual([]);
  });

  it("sem tarefa de pessoa aberta: passa, e as automáticas fecham depois da troca de dono", async () => {
    lead = { ...lead, owner_user_id: "outro-vendedor" };
    const res = await passar(TROCA);
    expect(res.status).toBe(200);
    expect(donosMudados).toBe(1);
    expect(automaticasFechadas).toEqual([LEAD]);
  });
});

async function resolver(acao: string, metodo: "POST" | "GET" = "POST") {
  const { POST, GET } = await import("@/app/api/v1/iavek/passagem/tarefas/route");
  if (metodo === "GET") return GET(new NextRequest(`http://x/api/v1/iavek/passagem/tarefas?lead_id=${LEAD}`));
  return POST(
    new NextRequest("http://x/api/v1/iavek/passagem/tarefas", { method: "POST", body: JSON.stringify({ lead_id: LEAD, task_id: TAREFA, acao }) }),
  );
}

describe("v1.9.62 (D4 2A): resolver as tarefas no passo da passagem", () => {
  it("'excluir' CANCELA com o motivo (não apaga), só se a tarefa é DESTE lead e está aberta; vai à linha do tempo", async () => {
    const res = await resolver("excluir");
    expect(res.status).toBe(200);
    expect(escritas).toHaveLength(1);
    expect(escritas[0]!.valores).toEqual({ status: "cancelled", cancelada_motivo: "excluida_ao_passar" });
    expect(escritas[0]!.filtros).toEqual(
      expect.arrayContaining([["organization_id", ORG], ["lead_id", LEAD], ["id", TAREFA], ["status", ["pending", "in_progress"]]]),
    );
    expect(atividades[0]).toMatchObject({ type: "task_cancelled", lead_id: LEAD });
  });

  it("'feita' marca done e registra a conclusão", async () => {
    const res = await resolver("feita");
    expect(res.status).toBe(200);
    expect(escritas[0]!.valores).toEqual({ status: "done" });
    expect(atividades[0]).toMatchObject({ type: "task_completed" });
  });

  it("'voltar' só reabre a que foi EXCLUÍDA neste passo", async () => {
    const res = await resolver("voltar");
    expect(res.status).toBe(200);
    expect(escritas[0]!.valores).toEqual({ status: "pending", cancelada_motivo: null });
    expect(escritas[0]!.filtros).toEqual(expect.arrayContaining([["status", ["cancelled"]], ["cancelada_motivo", "excluida_ao_passar"]]));
  });

  it("a tarefa que não é deste lead (ou já mudou): 409, nada na linha do tempo", async () => {
    tarefaVolta = false;
    const res = await resolver("excluir");
    expect(res.status).toBe(409);
    expect(atividades).toEqual([]);
  });

  it("quem não cuida do lead nem passa por função: 404 e nenhuma escrita", async () => {
    funcao = "vendedor";
    lead = { ...lead, owner_user_id: "outro", sdr_user_id: "outro" };
    const res = await resolver("excluir");
    expect(res.status).toBe(404);
    expect(escritas).toEqual([]);
  });

  it("a gerência resolve as de qualquer lead aberto", async () => {
    funcao = "vendedor";
    papel = "manager";
    lead = { ...lead, owner_user_id: "outro", sdr_user_id: "outro" };
    const res = await resolver("feita");
    expect(res.status).toBe(200);
  });

  it("lead fechado: 404", async () => {
    lead = { ...lead, status: "won" };
    const res = await resolver("feita");
    expect(res.status).toBe(404);
  });
});
