/**
 * ia.vek v1.9.52 (0634, CRM-254 a/b): na passagem das 72h, o clone do Follow-up fica com o SDR DE FOLLOW-UP da vez
 * (as ligações L3-L7 vêm junto, porque vão para o dono). Sem SDR de Follow-up ativo (ou se a escolha falha): a regra de
 * antes, o guardião (e, no lote antigo sem guardião, o dono do rodízio). O guardião do clone NÃO é mexido.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLONE = "22222222-2222-4222-8222-222222222222";
const GUARDIAO = "33333333-3333-4333-8333-333333333333";
const SDR_FU = "44444444-4444-4444-8444-444444444444";
const DONO_DO_LOTE = "55555555-5555-4555-8555-555555555555";

let updates: Array<Record<string, unknown>>;
let rpcs: Array<{ nome: string; args: unknown }>;
let respostaDaVez: { data: unknown; error: unknown };
let guardiaoDoClone: string | null;

vi.mock("@/lib/leads/clonar-lead-para-funil", () => ({
  clonarLeadParaFunil: async () => ({ ok: true, clone: { id: CLONE, organization_id: ORG, source_metadata: {}, owner_user_id: "dono-velho", contact_id: null } }),
}));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ performHumanHandoff: async () => undefined }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => null }));

function admin() {
  return {
    from(tabela: string) {
      let feito: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "not", "order", "limit", "in"]) q[m] = () => q;
      q.update = (v: Record<string, unknown>) => {
        if (tabela === "crm_leads") updates.push(v);
        feito = v;
        return q;
      };
      q.maybeSingle = async () => ({
        data: feito ? null : tabela === "crm_stages" ? { pipeline_id: "funil-fu" } : tabela === "crm_leads" ? { sdr_user_id: guardiaoDoClone } : null,
        error: null,
      });
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      return respostaDaVez;
    },
  };
}

async function passar(loteAntigo?: { dono: string; soL3: boolean }) {
  const { depsReaisDaEsteira } = await import("@/lib/esteira/deps-reais");
  const deps = depsReaisDaEsteira(admin() as never, ORG, () => new Date("2026-11-13T15:00:00Z"));
  return deps.passarParaFollowup({ id: "lead-original", contact_id: null, inicio: "2026-11-10T12:00:00Z" } as never, "etapa-fu", loteAntigo as never);
}

const donoGravado = () => updates.map((u) => u.owner_user_id).filter(Boolean);

beforeEach(() => {
  updates = [];
  rpcs = [];
  guardiaoDoClone = GUARDIAO;
  respostaDaVez = { data: SDR_FU, error: null };
});

describe("a passagem das 72h com o SDR de Follow-up", () => {
  it("o clone do Follow-up vai para o SDR de Follow-up da vez (não para o guardião)", async () => {
    const r = await passar();
    expect(r.ok).toBe(true);
    expect(rpcs).toEqual([{ nome: "fn_iavek_sdr_followup_da_vez", args: { p_org: ORG, p_lead: CLONE } }]);
    expect(donoGravado()).toEqual([SDR_FU]);
  });

  it("o guardião do clone NÃO é mexido (nenhum update toca no sdr_user_id)", async () => {
    await passar();
    expect(updates.some((u) => "sdr_user_id" in u)).toBe(false);
  });

  it("vale também para o lote antigo: o SDR de Follow-up vem antes do dono do rodízio", async () => {
    guardiaoDoClone = null;
    await passar({ dono: DONO_DO_LOTE, soL3: false });
    expect(donoGravado()).toEqual([SDR_FU]);
  });
});

describe("sem SDR de Follow-up: a regra de antes, nada muda", () => {
  it("nenhum ativo (a função devolve nulo): o dono é o guardião", async () => {
    respostaDaVez = { data: null, error: null };
    await passar();
    expect(donoGravado()).toEqual([GUARDIAO]);
  });

  it("a escolha falha (erro do banco): o dono é o guardião, e a passagem não cai", async () => {
    respostaDaVez = { data: null, error: { code: "XX000", message: "falhou" } };
    const r = await passar();
    expect(r.ok).toBe(true);
    expect(donoGravado()).toEqual([GUARDIAO]);
  });

  it("lote antigo sem guardião e sem SDR de Follow-up: o dono do rodízio", async () => {
    respostaDaVez = { data: null, error: null };
    guardiaoDoClone = null;
    await passar({ dono: DONO_DO_LOTE, soL3: false });
    expect(donoGravado()).toEqual([DONO_DO_LOTE]);
  });
});
