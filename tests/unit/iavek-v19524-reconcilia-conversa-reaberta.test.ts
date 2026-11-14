/**
 * v1.9.52.4 (Maestro 072000/072027, Lupa 071958): a reconciliação da esteira devolve ao SDR de Follow-up a conversa
 * que FICOU SEM DONO (a reabertura zera o dono no banco) de um contato com lead ABERTO no Follow-up dele. Só quando a
 * org NÃO tem atendimento automático no ar.
 *
 * Aqui (o TS): (d) com IA no ar, ou indefinido, NADA (nem a consulta roda); (a) cada conversa achada vai ao SDR de
 * Follow-up do lead pela passarAConversa, com o motivo, e entra na conta; uma falha numa não derruba as outras.
 * Os filtros da consulta, (b) o contato sem lead aberto no Follow-up e (c) a conversa com dono ('claimed' de outra
 * pessoa), a conversa com IA ativa e a fechada, são SQL: provados no banco de TESTE, numa transação desfeita
 * (~/operacao/medidas/v1524-reconcilia-conversa-no-teste.txt), e na prova do canário.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let iaNoAr: boolean | undefined = false;
const consultas: string[] = [];
let linhasDaConsulta: Array<Record<string, unknown>> = [];
const passadas: Array<Record<string, unknown>> = [];
let falharEm: string | null = null;

vi.mock("@/lib/ai/agents/org-tem-automatico", () => ({ orgTemAutomatico: async () => iaNoAr }));
vi.mock("@/lib/iavek/passar-a-conversa", () => ({
  passarAConversa: async (_a: unknown, args: Record<string, unknown>) => {
    if (args.contactId === falharEm) throw new Error("falhou");
    passadas.push(args);
  },
}));
vi.mock("@/lib/iavek/conversa-segue-o-dono", () => ({ conversaSegueODono: async () => false }));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ performHumanHandoff: async () => undefined }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({
  getRequestPool: () => ({
    query: async (sql: string) => {
      consultas.push(sql);
      // a 1ª consulta é a reconciliação de leads e tarefas (v1.9.52.3); a das conversas tem 'active_ai_agent_id'
      if (sql.includes("active_ai_agent_id")) return { rows: linhasDaConsulta };
      return { rows: [{ guardioes: 0, originais: 0, tarefas: 0 }] };
    },
  }),
}));

const ORG = "org-1";
const FUP = "funil-followup";

async function reconciliar() {
  const { depsReaisDaEsteira } = await import("@/lib/esteira/deps-reais");
  const deps = depsReaisDaEsteira({} as never, ORG, () => new Date("2026-11-14T08:00:00Z"));
  return deps.reconciliarFollowup!(FUP);
}

beforeEach(() => {
  iaNoAr = false;
  consultas.length = 0;
  passadas.length = 0;
  linhasDaConsulta = [];
  falharEm = null;
});

describe("v1.9.52.4: a reconciliação devolve a conversa reaberta sem dono ao SDR de Follow-up", () => {
  it("(a) a conversa sem dono do contato do Follow-up vai ao SDR de Follow-up do lead, com o motivo, e conta", async () => {
    linhasDaConsulta = [{ contact_id: "contato-1", owner_user_id: "sdr-c" }];
    const r = await reconciliar();
    expect(passadas).toEqual([
      expect.objectContaining({ orgId: ORG, contactId: "contato-1", para: "sdr-c", motivo: expect.stringContaining("reaberta") }),
    ]);
    expect(r).toEqual({ guardioes: 0, originais: 0, tarefas: 0, conversas: 1 });
  });

  it("(d) com IA no ar: NADA (nem a consulta das conversas roda)", async () => {
    iaNoAr = true;
    linhasDaConsulta = [{ contact_id: "contato-1", owner_user_id: "sdr-c" }];
    const r = await reconciliar();
    expect(passadas).toEqual([]);
    expect(consultas.some((s) => s.includes("active_ai_agent_id"))).toBe(false);
    expect(r.conversas).toBe(0);
  });

  it("(d) IA indefinida (não deu para saber) conta como 'tem': NADA", async () => {
    iaNoAr = undefined;
    linhasDaConsulta = [{ contact_id: "contato-1", owner_user_id: "sdr-c" }];
    const r = await reconciliar();
    expect(passadas).toEqual([]);
    expect(r.conversas).toBe(0);
  });

  it("a consulta só pega conversa SEM dono, SEM IA ativa, não fechada, de lead ABERTO do Follow-up de SDR de Follow-up", async () => {
    await reconciliar();
    const sql = consultas.find((s) => s.includes("active_ai_agent_id")) ?? "";
    expect(sql).toContain("v.assigned_to_user_id is null");
    expect(sql).toContain("v.active_ai_agent_id is null");
    expect(sql).toContain("v.status not in ('closed', 'resolved', 'archived')");
    expect(sql).toContain("c.pipeline_id = $2 and c.status = 'open'");
    expect(sql).toContain("interface_settings->>'funcao' = 'sdr_followup'");
    expect(sql).toContain("limit 200");
  });

  it("uma falha numa conversa não derruba as outras (e só conta as que passaram)", async () => {
    linhasDaConsulta = [
      { contact_id: "contato-1", owner_user_id: "sdr-c" },
      { contact_id: "contato-2", owner_user_id: "sdr-c" },
    ];
    falharEm = "contato-1";
    const r = await reconciliar();
    expect(passadas.map((p) => p.contactId)).toEqual(["contato-2"]);
    expect(r.conversas).toBe(1);
  });
});
