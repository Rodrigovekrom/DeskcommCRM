/**
 * ia.vek v1.9.52 (0634, CRM-254 a/b) e v1.9.62 (CRM-497, "sempre um cartão só"; D4 do Rodrigo): na passagem das 72h o
 * MESMO lead vai ao Follow-up (sem clone), numa escrita só, com o SDR DE FOLLOW-UP da vez como dono E guardião. Sem SDR
 * de Follow-up ativo (ou se a escolha falha): o guardião (e, no lote antigo sem guardião, o dono do rodízio). As tarefas
 * NÃO são reatribuídas: a função do banco fecha as automáticas ('passou_ao_followup') e as de pessoa
 * ('passagem_sem_revisao'), e o novo dono recebe o lead limpo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const GUARDIAO = "33333333-3333-4333-8333-333333333333";
const SDR_FU = "44444444-4444-4444-8444-444444444444";
const DONO_DO_LOTE = "55555555-5555-4555-8555-555555555555";
const DONO_VELHO = "66666666-6666-4666-8666-666666666666";

let updates: Array<Record<string, unknown>>;
let filtrosDoUpdate: Array<Array<[string, unknown]>>;
let tarefas: Array<Record<string, unknown>>;
let atividades: Array<Record<string, unknown>>;
let rpcs: Array<{ nome: string; args: unknown }>;
let respostaDaVez: { data: unknown; error: unknown };
let guardiaoDoLead: string | null;
let statusDoLead: string;
let moveAceito: boolean;
// v1.9.52.3: a conversa sem dono e a IA da org
let conversaDoContato: { assigned_to_user_id: string | null } | null;
let iaNoAr: boolean | undefined;
const passadas: Array<{ para: string | null }> = [];
let seguiuODono = false;
vi.mock("@/lib/iavek/conversa-segue-o-dono", () => ({ conversaSegueODono: async () => seguiuODono }));
vi.mock("@/lib/ai/agents/org-tem-automatico", () => ({ orgTemAutomatico: async () => iaNoAr }));
vi.mock("@/lib/iavek/passar-a-conversa", () => ({
  passarAConversa: async (_a: unknown, args: { para: string | null }) => void passadas.push({ para: args.para }),
}));
// v1.9.62: a passagem não clona mais. Se alguém chamar o clone, o teste quebra.
vi.mock("@/lib/leads/clonar-lead-para-funil", () => ({
  clonarLeadParaFunil: async () => {
    throw new Error("a passagem da 62 não clona");
  },
}));
vi.mock("@/lib/agent-engine/agent/human-handoff", () => ({ performHumanHandoff: async () => undefined }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => null }));

function admin() {
  return {
    from(tabela: string) {
      let feito: Record<string, unknown> | null = null;
      const filtros: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "is", "not", "order", "limit", "neq", "in"]) q[m] = () => q;
      q.eq = (k: string, v: unknown) => {
        filtros.push([k, v]);
        return q;
      };
      q.update = (v: Record<string, unknown>) => {
        feito = v;
        if (tabela === "crm_leads") {
          updates.push(v);
          filtrosDoUpdate.push(filtros);
        }
        if (tabela === "crm_tasks") tarefas.push(v);
        return q;
      };
      q.insert = async (v: Record<string, unknown>) => {
        if (tabela === "crm_lead_activities") atividades.push(v);
        return { error: null };
      };
      q.maybeSingle = async () => {
        if (feito) return { data: tabela === "crm_leads" && moveAceito ? { id: LEAD } : null, error: null };
        if (tabela === "crm_stages") return { data: { pipeline_id: "funil-fu" }, error: null };
        if (tabela === "crm_leads") {
          return {
            data: {
              id: LEAD,
              contact_id: null,
              pipeline_id: "funil-entrada",
              stage_id: "etapa-entrada",
              status: statusDoLead,
              created_at: "2026-11-10T12:00:00Z",
              owner_user_id: DONO_VELHO,
              sdr_user_id: guardiaoDoLead,
              source_metadata: { origem: "anuncio" },
              esteira_passou_em: null,
            },
            error: null,
          };
        }
        if (tabela === "conversations") return { data: conversaDoContato, error: null };
        return { data: null, error: null };
      };
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      if (nome === "fn_iavek_tarefas_da_passagem") return { data: { automaticas: 1, de_pessoa: 1 }, error: null };
      return respostaDaVez;
    },
  };
}

async function passar(loteAntigo?: { dono: string; soL3: boolean }, contato: string | null = null) {
  const { depsReaisDaEsteira } = await import("@/lib/esteira/deps-reais");
  const deps = depsReaisDaEsteira(admin() as never, ORG, () => new Date("2026-11-13T15:00:00Z"));
  return deps.passarParaFollowup({ id: LEAD, contact_id: contato, inicio: "2026-11-10T12:00:00Z" } as never, "etapa-fu", loteAntigo as never);
}

const donoGravado = () => updates.map((u) => u.owner_user_id).filter(Boolean);

beforeEach(() => {
  updates = [];
  filtrosDoUpdate = [];
  tarefas = [];
  atividades = [];
  rpcs = [];
  guardiaoDoLead = GUARDIAO;
  statusDoLead = "open";
  moveAceito = true;
  conversaDoContato = null;
  iaNoAr = undefined;
  passadas.length = 0;
  seguiuODono = false;
  respostaDaVez = { data: SDR_FU, error: null };
});

describe("v1.9.62: a passagem MOVE o mesmo lead (um cartão só)", () => {
  it("uma escrita só no MESMO lead: funil, etapa, dono, guardião, a data e o rastro da passagem", async () => {
    const r = await passar();
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      pipeline_id: "funil-fu",
      stage_id: "etapa-fu",
      esteira_passou_em: "2026-11-13T15:00:00.000Z",
      owner_user_id: SDR_FU,
      owner_kind: "user",
      owner_agent_id: null,
      sdr_user_id: SDR_FU,
    });
    expect(updates[0]!.source_metadata).toMatchObject({
      origem: "anuncio",
      esteira_inicio: "2026-11-10T12:00:00Z",
      passagem: { em: "2026-11-13T15:00:00.000Z", de_pipeline: "funil-entrada", de_etapa: "etapa-entrada", de_dono: DONO_VELHO, venceu_72h: true },
    });
    if (r.ok) expect(r.lead).toMatchObject({ id: LEAD, stage_id: "etapa-fu", passou_em: "2026-11-13T15:00:00.000Z" });
  });

  it("a escrita só vale se o lead ainda está aberto no funil que a rodada leu (não atropela outra escrita)", async () => {
    await passar();
    expect(filtrosDoUpdate[0]).toEqual(
      expect.arrayContaining([
        ["organization_id", ORG],
        ["id", LEAD],
        ["status", "open"],
        ["pipeline_id", "funil-entrada"],
      ]),
    );
  });

  it("se a escrita não pegou (o lead mudou no meio), a passagem falha e nada mais roda", async () => {
    moveAceito = false;
    const r = await passar();
    expect(r.ok).toBe(false);
    expect(rpcs.some((x) => x.nome === "fn_iavek_tarefas_da_passagem")).toBe(false);
    expect(atividades).toEqual([]);
  });

  it("lead que não está aberto não passa", async () => {
    statusDoLead = "lost";
    const r = await passar();
    expect(r).toEqual({ ok: false, erro: "lead_nao_esta_aberto" });
    expect(updates).toEqual([]);
  });

  it("a linha do tempo: um stage_changed entre funis, com passagem_72h", async () => {
    await passar();
    expect(atividades).toHaveLength(1);
    expect(atividades[0]).toMatchObject({ type: "stage_changed", lead_id: LEAD });
    expect(atividades[0]!.payload).toMatchObject({ from_pipeline_id: "funil-entrada", pipeline_id: "funil-fu", passagem_72h: true });
  });
});

describe("v1.9.62 (D4 3A do Rodrigo): as tarefas na passagem SEM pessoa", () => {
  it("chama a função do banco com os 2 motivos; nenhuma tarefa é reatribuída", async () => {
    await passar();
    expect(rpcs).toContainEqual({
      nome: "fn_iavek_tarefas_da_passagem",
      args: { p_org: ORG, p_lead: LEAD, p_motivo_automaticas: "passou_ao_followup", p_motivo_de_pessoa: "passagem_sem_revisao" },
    });
    expect(tarefas).toEqual([]);
  });

  it("vale também sem SDR de Follow-up (a regra das tarefas não depende de quem recebe)", async () => {
    respostaDaVez = { data: null, error: null };
    await passar();
    expect(rpcs.some((x) => x.nome === "fn_iavek_tarefas_da_passagem")).toBe(true);
    expect(tarefas).toEqual([]);
  });
});

describe("o dono no Follow-up (CRM-254)", () => {
  it("o SDR de Follow-up da vez (não o guardião), perguntado pelo id do PRÓPRIO lead", async () => {
    await passar();
    expect(rpcs[0]).toEqual({ nome: "fn_iavek_sdr_followup_da_vez", args: { p_org: ORG, p_lead: LEAD } });
    expect(donoGravado()).toEqual([SDR_FU]);
  });

  it("vale também para o lote antigo: o SDR de Follow-up vem antes do dono do rodízio", async () => {
    guardiaoDoLead = null;
    await passar({ dono: DONO_DO_LOTE, soL3: false });
    expect(donoGravado()).toEqual([SDR_FU]);
    expect(updates[0]!.source_metadata).toMatchObject({ esteira_lote_antigo: { em: "2026-11-13T15:00:00.000Z", so_l3: false } });
  });

  it("nenhum ativo (a função devolve nulo): o dono é o guardião, e o guardião não é mexido", async () => {
    respostaDaVez = { data: null, error: null };
    await passar();
    expect(donoGravado()).toEqual([GUARDIAO]);
    expect("sdr_user_id" in updates[0]!).toBe(false);
  });

  it("a escolha falha (erro do banco): o dono é o guardião, e a passagem não cai", async () => {
    respostaDaVez = { data: null, error: { code: "XX000", message: "falhou" } };
    const r = await passar();
    expect(r.ok).toBe(true);
    expect(donoGravado()).toEqual([GUARDIAO]);
  });

  it("lote antigo sem guardião e sem SDR de Follow-up: o dono do rodízio", async () => {
    respostaDaVez = { data: null, error: null };
    guardiaoDoLead = null;
    await passar({ dono: DONO_DO_LOTE, soL3: false });
    expect(donoGravado()).toEqual([DONO_DO_LOTE]);
  });

  it("sem guardião, sem SDR de Follow-up e fora do lote antigo: fica o dono de agora", async () => {
    respostaDaVez = { data: null, error: null };
    guardiaoDoLead = null;
    await passar();
    expect(donoGravado()).toEqual([DONO_VELHO]);
  });
});

describe("52.3: a conversa SEM dono (Maestro 002322, Lupa 002339: pela MESMA função da Fila, orgTemAutomatico)", () => {
  it("org SEM atendimento automático no ar: a conversa sem dono vai ao SDR de Follow-up", async () => {
    conversaDoContato = { assigned_to_user_id: null };
    iaNoAr = false;
    await passar(undefined, "contato-1");
    expect(passadas).toEqual([{ para: SDR_FU }]);
  });
  it("org COM atendimento automático: a conversa sem dono FICA com a IA (não cala)", async () => {
    conversaDoContato = { assigned_to_user_id: null };
    iaNoAr = true;
    await passar(undefined, "contato-1");
    expect(passadas).toEqual([]);
  });
  it("não deu para saber (indefinido): conta como 'tem IA' e não mexe", async () => {
    conversaDoContato = { assigned_to_user_id: null };
    iaNoAr = undefined;
    await passar(undefined, "contato-1");
    expect(passadas).toEqual([]);
  });
  it("a conversa com uma PESSOA segue pela regra de sempre (conversaSegueODono); a da IA não é tocada de novo", async () => {
    seguiuODono = true;
    conversaDoContato = { assigned_to_user_id: null };
    iaNoAr = false;
    await passar(undefined, "contato-1");
    expect(passadas).toEqual([]);
  });
  it("sem SDR de Follow-up: nada disso roda", async () => {
    respostaDaVez = { data: null, error: null };
    conversaDoContato = { assigned_to_user_id: null };
    iaNoAr = false;
    await passar(undefined, "contato-1");
    expect(passadas).toEqual([]);
  });
});
