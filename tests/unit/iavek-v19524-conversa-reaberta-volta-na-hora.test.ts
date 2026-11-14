/**
 * v1.9.52.4 (Maestro 073112, Lupa 073050): a conversa (re)aberta por um atendimento que ficou SEM dono volta NA HORA ao
 * SDR de Follow-up do lead. Medido no canário (14/11): o 'cliente voltou'/as automações (o begin por evento) e o
 * 'Abrir conversa' reabrem a conversa fechada e o banco zera o dono; a fila passava a vê-la.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let iaNoAr: boolean | undefined = false;
vi.mock("@/lib/ai/agents/org-tem-automatico", () => ({ orgTemAutomatico: async () => iaNoAr }));

import { conversaSemDonoVoltaAoFollowup } from "@/lib/iavek/conversa-reaberta-volta-ao-followup";

const ORG = "org-1";
const CONTATO = "contato-1";
const CONVERSA = "conversa-1";
const C = "sdr-followup-c";

type Mundo = {
  conversa: { assigned_to_user_id: string | null; active_ai_agent_id: string | null; status: string } | null;
  funil: string | null;
  lead: { owner_user_id: string | null } | null;
  membroFollowup: boolean;
  erroNoAssign: boolean;
  explodir: boolean;
};

let m: Mundo;
let rpc: ReturnType<typeof vi.fn>;
const filtrosDoMembro: Array<[string, unknown]> = [];

function admin() {
  rpc = vi.fn(async () => ({ error: m.erroNoAssign ? { message: "falhou" } : null }));
  return {
    rpc,
    from: (tabela: string) => {
      if (m.explodir) throw new Error("banco fora");
      const q: Record<string, unknown> = {};
      for (const k of ["select", "order", "limit"]) q[k] = () => q;
      q.eq = (k: string, v: unknown) => {
        if (tabela === "user_organizations") filtrosDoMembro.push([k, v]);
        return q;
      };
      q.is = (k: string, v: unknown) => {
        if (tabela === "user_organizations") filtrosDoMembro.push([`is:${k}`, v]);
        return q;
      };
      q.maybeSingle = async () => {
        if (tabela === "conversations") return { data: m.conversa };
        if (tabela === "organizations") return { data: { settings: m.funil ? { esteira: { followup: { pipeline_id: m.funil } } } : {} } };
        if (tabela === "crm_leads") return { data: m.lead };
        if (tabela === "user_organizations") return { data: m.membroFollowup ? { user_id: C } : null };
        return { data: null };
      };
      return q;
    },
  };
}

const rodar = (a = admin()) => conversaSemDonoVoltaAoFollowup(a as never, ORG, CONTATO, CONVERSA);

beforeEach(() => {
  iaNoAr = false;
  filtrosDoMembro.length = 0;
  m = {
    conversa: { assigned_to_user_id: null, active_ai_agent_id: null, status: "open" },
    funil: "funil-followup",
    lead: { owner_user_id: C },
    membroFollowup: true,
    erroNoAssign: false,
    explodir: false,
  };
});

describe("v1.9.52.4: a conversa reaberta sem dono volta na hora ao SDR de Follow-up", () => {
  it("tudo vale: a conversa vai ao SDR de Follow-up do lead pela transferência de sempre", async () => {
    expect(await rodar()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_conversation_assign", {
      p_organization_id: ORG,
      p_conversation_id: CONVERSA,
      p_to_user_id: C,
      p_reason: "transfer",
      p_enforce_expected: false,
    });
    // o dono do lead tem de ser SDR de Follow-up ATIVO
    expect(filtrosDoMembro).toEqual(
      expect.arrayContaining([["user_id", C], ["is:revoked_at", null], ["interface_settings->>funcao", "sdr_followup"]]),
    );
  });

  it.each([
    ["a conversa já tem dono (a 'claimed' de outra pessoa)", () => (m.conversa = { assigned_to_user_id: "outro", active_ai_agent_id: null, status: "claimed" })],
    ["a conversa está com a IA", () => (m.conversa = { assigned_to_user_id: null, active_ai_agent_id: "ia-1", status: "ai_handling" })],
    ["a conversa está fechada", () => (m.conversa = { assigned_to_user_id: null, active_ai_agent_id: null, status: "closed" })],
    ["a org não tem funil de Follow-up", () => (m.funil = null)],
    ["o contato não tem lead aberto no Follow-up", () => (m.lead = null)],
    ["o lead do Follow-up está sem dono", () => (m.lead = { owner_user_id: null })],
    ["o dono do lead NÃO é SDR de Follow-up ativo", () => (m.membroFollowup = false)],
    ["a org tem IA no ar", () => (iaNoAr = true)],
    ["não deu para saber se há IA (indefinido = tem)", () => (iaNoAr = undefined)],
  ])("NÃO mexe quando %s", async (_rotulo, preparar) => {
    preparar();
    expect(await rodar()).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a transferência falha: devolve false, sem derrubar o atendimento", async () => {
    m.erroNoAssign = true;
    expect(await rodar()).toBe(false);
  });

  it("o banco explode: devolve false, sem lançar (o atendimento segue)", async () => {
    m.explodir = true;
    await expect(rodar()).resolves.toBe(false);
  });
});

// (Maestro 073121, Lupa 073050) o caminho do EVENTO ('cliente voltou', automações): o serviceForEvent chama a volta
// na hora com a conversa que o banco abriu; e o beginServiceAtOrigin (o 'Abrir conversa', as automações) também.
describe("v1.9.52.4: a origem do atendimento chama a volta na hora", () => {
  const FRONT = { organization_id: ORG, contact_id: CONTATO, conversation_id: CONVERSA, service_revision: 2, demanda_id: null, demanda_revision: null, status: "open", demanda_fechada_em: null };
  const chamado = vi.fn(async () => true);

  async function origem() {
    vi.resetModules();
    vi.doMock("@/lib/iavek/conversa-reaberta-volta-ao-followup", () => ({ conversaSemDonoVoltaAoFollowup: chamado }));
    vi.doMock("@/lib/atendimento/fronteira-server", () => ({ currentExecutionBoundary: () => null, guardServiceEffect: async () => undefined }));
    return import("@/lib/atendimento/origem");
  }
  const adminDoBanco = () => ({ rpc: vi.fn(async () => ({ data: FRONT, error: null })) });

  beforeEach(() => chamado.mockClear());

  it("serviceForEvent (o begin por EVENTO): chama a volta na hora com a conversa aberta", async () => {
    const { serviceForEvent } = await origem();
    const b = await serviceForEvent(adminDoBanco() as never, ORG, "evento-1", CONTATO);
    expect(b?.conversation_id).toBe(CONVERSA);
    expect(chamado).toHaveBeenCalledWith(expect.anything(), ORG, CONTATO, CONVERSA);
  });

  it("beginServiceAtOrigin (o 'Abrir conversa', as automações): chama a volta na hora", async () => {
    const { beginServiceAtOrigin } = await origem();
    await beginServiceAtOrigin(adminDoBanco() as never, ORG, CONTATO, "sess-1");
    expect(chamado).toHaveBeenCalledWith(expect.anything(), ORG, CONTATO, CONVERSA);
  });
});

// (Lupa 074351, Maestro 074400) a transferência acontece DEPOIS do begin, e a origem devolve a fronteira de ANTES. O
// próximo passo (a automação enviando: assertServiceBoundarySupabase) compara campo a campo com a fronteira ATUAL; a
// transferência (fn_conversation_assign) muda o dono e o status para 'claimed', NÃO a revisão nem a demanda. Então NÃO
// dá stale. Aqui com a régua REAL (assertCurrentServiceBoundary), sem fake.
describe("v1.9.52.4: a fronteira devolvida segue válida depois da transferência (sem service_stale)", () => {
  it("a fronteira de antes x a atual depois do assign ('claimed', mesma revisão e demanda): NÃO lança", async () => {
    const { assertCurrentServiceBoundary } = await vi.importActual<typeof import("@/lib/atendimento/fronteira")>("@/lib/atendimento/fronteira");
    const antes = { organization_id: ORG, contact_id: CONTATO, conversation_id: CONVERSA, service_revision: 4, demanda_id: null, demanda_revision: null };
    const depoisDoAssign = { ...antes, status: "claimed", demanda_fechada_em: null };
    expect(() => assertCurrentServiceBoundary(antes as never, depoisDoAssign as never)).not.toThrow();
  });

  it("contra-prova da régua: se a REVISÃO mudasse, daria stale", async () => {
    const { assertCurrentServiceBoundary } = await vi.importActual<typeof import("@/lib/atendimento/fronteira")>("@/lib/atendimento/fronteira");
    const antes = { organization_id: ORG, contact_id: CONTATO, conversation_id: CONVERSA, service_revision: 4, demanda_id: null, demanda_revision: null };
    expect(() => assertCurrentServiceBoundary(antes as never, { ...antes, service_revision: 5, status: "claimed", demanda_fechada_em: null } as never)).toThrow();
  });
});
