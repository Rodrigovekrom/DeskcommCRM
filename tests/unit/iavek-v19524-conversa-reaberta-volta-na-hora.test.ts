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
