/**
 * ia.vek v1.9.62 (CRM-497, D4 1A + P1, ponto único em lib/iavek/regras-da-passagem.ts): na LOJA, a pessoa que troca o
 * dono pelo quadro (PATCH /api/v1/leads/:id) também resolve antes as tarefas de pessoa abertas: 409 tarefas_abertas e
 * o handler NÃO roda. Sem tarefa aberta: troca, e as automáticas fecham. Fora da loja, ou sem mudar o dono, nada muda.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "44444444-4444-4444-8444-444444444444";
const EU = "22222222-2222-4222-8222-222222222222";
const NOVO = "33333333-3333-4333-8333-333333333333";

let abertas: unknown[];
let handler: number;
let fechadas: string[];
let loja: boolean;

function mocks() {
  vi.resetModules();
  vi.doMock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
  vi.doMock("@/lib/api/auth-dual", () => ({
    resolveAuthDual: async () => ({ ok: true, via: "session", supabase: {}, organizationId: ORG, actor: { type: "user", id: EU }, idioma: "pt-BR" }),
    tetoDeEscritaDoToken: async () => null,
  }));
  vi.doMock("@/lib/iavek/etiquetas", () => ({ recusaEtiquetaNova: async () => null }));
  vi.doMock("@/lib/iavek/contato-no-alcance", () => ({ funcaoNaOrganizacao: async () => null }));
  vi.doMock("@/lib/iavek/funcoes", async (orig) => ({ ...(await orig<Record<string, unknown>>()), trocaResponsavel: () => true }));
  vi.doMock("@/lib/iavek/perfil-da-empresa", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    ehLojaDeCarros: () => loja,
    lerPerfilDaEmpresa: () => ({ modo_agendamento: false }),
  }));
  vi.doMock("@/lib/iavek/passagem-servidor", () => ({
    tarefasDePessoaAbertas: async () => abertas,
    fecharAutomaticasDaPassagem: async (_a: unknown, _o: string, id: string) => void fechadas.push(id),
  }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () => ({
      from: (tabela: string) => {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.maybeSingle = async () => ({ data: tabela === "crm_leads" ? { owner_user_id: EU, status: "open" } : { settings: {} }, error: null });
        return q;
      },
    }),
  }));
  vi.doMock("@/app/api/v1/leads/_handler", () => ({
    updateLeadHandler: async () => {
      handler += 1;
      return { id: LEAD };
    },
  }));
}

async function patch(corpo: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/v1/leads/[id]/route");
  return PATCH(new NextRequest(`http://x/api/v1/leads/${LEAD}`, { method: "PATCH", body: JSON.stringify(corpo) }), {
    params: Promise.resolve({ id: LEAD }),
  } as never);
}

beforeEach(() => {
  abertas = [];
  handler = 0;
  fechadas = [];
  loja = true;
  mocks();
});

describe("P1: a troca de dono pelo quadro exige as tarefas resolvidas (na loja)", () => {
  it("com tarefa de pessoa aberta: 409 tarefas_abertas e o handler NÃO roda", async () => {
    abertas = [{ id: "t1", title: "Retornar", assigned_to: EU, due_date: null, status: "pending" }];
    const res = await patch({ owner_user_id: NOVO });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tarefas_abertas");
    expect(handler).toBe(0);
  });

  it("sem tarefa aberta: troca, e as automáticas fecham", async () => {
    const res = await patch({ owner_user_id: NOVO });
    expect(res.status).toBe(200);
    expect(handler).toBe(1);
    expect(fechadas).toEqual([LEAD]);
  });

  it("o mesmo dono (não muda de mãos): nada a conferir nem fechar", async () => {
    abertas = [{ id: "t1" }];
    const res = await patch({ owner_user_id: EU });
    expect(res.status).toBe(200);
    expect(fechadas).toEqual([]);
  });

  it("fora da loja: como antes", async () => {
    loja = false;
    abertas = [{ id: "t1" }];
    const res = await patch({ owner_user_id: NOVO });
    expect(res.status).toBe(200);
    expect(fechadas).toEqual([]);
  });
});
