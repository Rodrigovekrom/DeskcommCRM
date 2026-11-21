/**
 * ia.vek v1.9.62 (CRM-497, "sempre um cartão só"; desenho v5 7fe7db2f + v6 8201d8ce): a passagem das 72h e a volta pelo
 * reengajo MOVEM o mesmo lead. O que isso muda na régua (rodada.ts) e na volta (reativarLead):
 *  - no Follow-up, o "voltou a falar" e as ligações contam da PASSAGEM (`passou_em`), não do created_at da entrada;
 *  - na entrada, a régua (L1, L2) e o handoff contam do começo do CICLO (`inicio`): o lead que voltou faz L1/L2 de novo;
 *  - o lead que voltou à entrada é da esteira mesmo nascido antes de `desde`, e não é do lote antigo;
 *  - a volta move o mesmo lead (sem clone), com guardas, e as tarefas fecham com motivo (D4).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PADRAO_DA_ESTEIRA, type ConfigDaEsteira } from "@/lib/esteira/config";
import { HORA, rodarEsteira, type DepsDaEsteira, type LeadDaEsteira } from "@/lib/esteira/rodada";

const E = "00000000-0000-4000-8000-0000000000e1";
const F = "00000000-0000-4000-8000-0000000000f1";
const NOVO = "00000000-0000-4000-8000-000000000101";
const F3 = "00000000-0000-4000-8000-000000000201";
const VOLTOU = "00000000-0000-4000-8000-000000000205";
const AGORA = new Date("2026-11-23T15:00:00Z");
const ha = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();

function cfg(desde?: string): ConfigDaEsteira {
  return {
    ...PADRAO_DA_ESTEIRA,
    funis: {
      entrada: { pipeline_id: E, horas: 72, etapas_de_compromisso: [], ...(desde ? { desde } : {}) },
      followup: { pipeline_id: F, fases: [{ ate_dia: 90, etapa_id: F3 }], etapa_reengajou: VOLTOU },
    },
  };
}

function lead(p: Partial<LeadDaEsteira> & { id: string }): LeadDaEsteira {
  const created = p.created_at ?? ha(HORA);
  return { contact_id: "c-" + p.id, stage_id: NOVO, owner_user_id: null, inicio: created, created_at: created, ...p };
}

function montar(o: { entrada?: LeadDaEsteira[]; followup?: LeadDaEsteira[]; lote?: boolean }) {
  const log = {
    falouDesde: [] as Array<[string, string]>,
    ligacoesDesde: [] as Array<Record<string, string> | undefined>,
    handoffDesde: [] as Array<Record<string, string> | undefined>,
    criadas: [] as Array<[string, string]>,
    passados: [] as string[],
  };
  const deps: DepsDaEsteira = {
    agora: () => AGORA,
    leadsAbertos: async (pid) => (pid === E ? (o.entrada ?? []) : (o.followup ?? [])),
    passadosDoLoteAntigoDesde: async () => 0,
    passarParaFollowup: async (l) => {
      log.passados.push(l.id);
      return { ok: true, lead: { ...l, stage_id: F3, passou_em: AGORA.toISOString() } };
    },
    leadAbertoNoFollowup: async () => null,
    fecharApontandoParaFollowup: async () => false,
    mover: async () => true,
    comHandoff: async (ids, desde) => {
      log.handoffDesde.push(desde ? Object.fromEntries(desde) : undefined);
      return new Set(ids);
    },
    clienteFalouDesde: async (l, desde) => {
      log.falouDesde.push([l.id, desde.toISOString()]);
      return false;
    },
    ultimoReengajo: async () => null,
    marcarReengajou: async () => {},
    ligacoesJaCriadas: async (_ids, desde) => {
      log.ligacoesDesde.push(desde ? Object.fromEntries(desde) : undefined);
      return new Map();
    },
    criarLigacao: async (l, codigo) => {
      log.criadas.push([l.id, codigo]);
      return true;
    },
    perderSemRetorno: async () => true,
    ligacoesVencidas: async () => [],
    cobrancasFeitas: async () => new Map(),
    cobrar: async () => {},
  };
  return { deps, log };
}

describe("v1.9.62: a régua conta do trecho do mesmo lead", () => {
  it("no Follow-up, o 'voltou a falar' conta da PASSAGEM (não do created_at da entrada)", async () => {
    const passou = ha(2 * 24 * HORA);
    const l = lead({ id: "a", stage_id: F3, created_at: ha(10 * 24 * HORA), inicio: ha(10 * 24 * HORA), passou_em: passou });
    const { deps, log } = montar({ followup: [l] });
    await rodarEsteira(cfg(), deps);
    expect(log.falouDesde).toContainEqual(["a", new Date(passou).toISOString()]);
  });

  it("o clone de antes da 62 (sem passou_em) segue pelo created_at dele, como antes", async () => {
    const criado = ha(5 * 24 * HORA);
    const l = lead({ id: "b", stage_id: F3, created_at: criado, inicio: ha(10 * 24 * HORA) });
    const { deps, log } = montar({ followup: [l] });
    await rodarEsteira(cfg(), deps);
    expect(log.falouDesde).toContainEqual(["b", new Date(criado).toISOString()]);
  });

  it("as ligações do Follow-up contam desde a passagem; as da entrada, desde o começo do ciclo", async () => {
    const passou = ha(2 * 24 * HORA);
    const noFu = lead({ id: "fu", stage_id: F3, created_at: ha(10 * 24 * HORA), inicio: ha(10 * 24 * HORA), passou_em: passou });
    const inicioDoCiclo = ha(10 * HORA);
    const naEntrada = lead({ id: "en", created_at: ha(20 * 24 * HORA), inicio: inicioDoCiclo, passou_em: ha(9 * 24 * HORA) });
    const { deps, log } = montar({ entrada: [naEntrada], followup: [noFu] });
    await rodarEsteira(cfg(), deps);
    expect(log.ligacoesDesde[0]).toEqual({ en: inicioDoCiclo });
    expect(log.handoffDesde[0]).toEqual({ en: inicioDoCiclo });
    expect(log.ligacoesDesde[1]).toEqual({ fu: passou });
  });

  it("o lead que VOLTOU à entrada é da esteira mesmo nascido antes de `desde` (ganha L1/L2 do ciclo novo)", async () => {
    const desde = ha(30 * 24 * HORA);
    const voltou = lead({ id: "v", created_at: ha(60 * 24 * HORA), inicio: ha(50 * HORA), passou_em: ha(20 * 24 * HORA) });
    const nuncaFoi = lead({ id: "n", created_at: ha(60 * 24 * HORA), inicio: ha(60 * 24 * HORA) });
    const { deps, log } = montar({ entrada: [voltou, nuncaFoi] });
    await rodarEsteira(cfg(desde), deps);
    expect(log.criadas).toContainEqual(["v", "L1"]);
    expect(log.criadas).toContainEqual(["v", "L2"]);
    expect(log.criadas.some(([id]) => id === "n")).toBe(false);
  });
});

// ── a volta: reativarLead move o mesmo lead ────────────────────────────────────
const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const SDR = "33333333-3333-4333-8333-333333333333";
const ETAPA_DE_ENTRADA = "00000000-0000-4000-8000-000000000109";

const passadas: Array<string | null> = [];
vi.mock("@/lib/iavek/passar-a-conversa", () => ({
  passarAConversa: async (_a: unknown, args: { para: string | null }) => void passadas.push(args.para),
}));
vi.mock("@/lib/leads/clonar-lead-para-funil", () => ({
  clonarLeadParaFunil: async () => {
    throw new Error("a volta da 62 não clona");
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

let updates: Array<{ v: Record<string, unknown>; filtros: Array<[string, unknown]> }>;
let rpcs: Array<{ nome: string; args: unknown }>;
let atividades: Array<Record<string, unknown>>;
let moveAceito: boolean;

function admin() {
  return {
    from(tabela: string) {
      let feito: Record<string, unknown> | null = null;
      const filtros: Array<[string, unknown]> = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "is", "not", "order", "limit", "neq", "in", "gte"]) q[m] = () => q;
      q.eq = (k: string, v: unknown) => {
        filtros.push([k, v]);
        return q;
      };
      q.update = (v: Record<string, unknown>) => {
        feito = v;
        if (tabela === "crm_leads") updates.push({ v, filtros });
        return q;
      };
      q.insert = async (v: Record<string, unknown>) => {
        if (tabela === "crm_lead_activities") atividades.push(v);
        return { error: null };
      };
      q.maybeSingle = async () => {
        if (feito) return { data: tabela === "crm_leads" && moveAceito ? { id: LEAD } : null, error: null };
        if (tabela === "organizations") {
          return { data: { settings: { esteira: { entrada: { pipeline_id: E, horas: 72, etapas_de_compromisso: [] } } } }, error: null };
        }
        if (tabela === "crm_pipelines") return { data: { settings: { etapa_de_entrada: "novo" } }, error: null };
        if (tabela === "crm_stages") return { data: { id: ETAPA_DE_ENTRADA }, error: null };
        if (tabela === "user_organizations") {
          return { data: { user_id: SDR, role: "agent", revoked_at: null, interface_settings: { funcao: "sdr_followup" } }, error: null };
        }
        if (tabela === "crm_leads") return { data: { ...leadDoFollowup(), pipeline_id: E }, error: null };
        return { data: null, error: null };
      };
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      return { data: { automaticas: 0, de_pessoa: 0 }, error: null };
    },
  };
}

function leadDoFollowup() {
  return {
    id: LEAD,
    organization_id: ORG,
    pipeline_id: F,
    stage_id: VOLTOU,
    contact_id: "contato-1",
    owner_user_id: SDR,
    sdr_user_id: null,
    status: "open",
    created_at: "2026-11-01T12:00:00Z",
    custom_fields: {},
    source_metadata: { origem: "anuncio", esteira_inicio: "2026-11-01T12:00:00Z" },
  };
}

async function voltar(atorId: string | null, lead = leadDoFollowup()) {
  const { reativarLead } = await import("@/lib/iavek/passagem-servidor");
  const ctx = { organization_id: ORG, actor: { type: "webhook_source", id: "esteira" }, requestId: "t" } as never;
  return reativarLead(admin() as never, ctx, lead as never, { atorId, motivo: "voltou a falar" });
}

beforeEach(() => {
  updates = [];
  rpcs = [];
  atividades = [];
  moveAceito = true;
  passadas.length = 0;
});

describe("v1.9.62: a volta (reativarLead) move o MESMO lead para a entrada", () => {
  it("uma escrita no próprio lead: funil e etapa de entrada, ciclo novo, o SDR de Follow-up como dono e guardião", async () => {
    const r = await voltar(null);
    expect(r).toEqual({ ok: true, novoLeadId: LEAD, para: SDR });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.v).toMatchObject({
      pipeline_id: E,
      stage_id: ETAPA_DE_ENTRADA,
      owner_user_id: SDR,
      sdr_user_id: SDR,
    });
    const md = updates[0]!.v.source_metadata as Record<string, unknown>;
    expect(md.origem).toBe("anuncio");
    expect(md.esteira_inicio).not.toBe("2026-11-01T12:00:00Z");
    expect(md.volta).toMatchObject({ de_pipeline: F, de_etapa: VOLTOU, de_dono: SDR, motivo: "voltou a falar" });
    expect(updates[0]!.filtros).toEqual(expect.arrayContaining([["id", LEAD], ["status", "open"], ["pipeline_id", F]]));
  });

  it("SEM pessoa (a esteira): as de pessoa também fecham, com 'passagem_sem_revisao'", async () => {
    await voltar(null);
    expect(rpcs).toContainEqual({
      nome: "fn_iavek_tarefas_da_passagem",
      args: { p_org: ORG, p_lead: LEAD, p_motivo_automaticas: "passou_o_lead", p_motivo_de_pessoa: "passagem_sem_revisao" },
    });
  });

  it("COM pessoa (o botão Reativar): só as automáticas fecham (a rota já exigiu zero de pessoa abertas)", async () => {
    await voltar(SDR);
    expect(rpcs).toContainEqual({
      nome: "fn_iavek_tarefas_da_passagem",
      args: { p_org: ORG, p_lead: LEAD, p_motivo_automaticas: "passou_o_lead", p_motivo_de_pessoa: null },
    });
  });

  it("a linha do tempo da volta: stage_changed entre funis, com volta_da_esteira", async () => {
    await voltar(null);
    const troca = atividades.find((a) => a.type === "stage_changed");
    expect(troca?.payload).toMatchObject({ from_pipeline_id: F, pipeline_id: E, volta_da_esteira: true });
  });

  it("o lead mudou no meio (a escrita não pegou): falha, e nada de tarefas nem conversa", async () => {
    moveAceito = false;
    const r = await voltar(null);
    expect(r.ok).toBe(false);
    expect(rpcs).toEqual([]);
    expect(passadas).toEqual([]);
  });

  it("lead fechado ou já na entrada não volta", async () => {
    expect(await voltar(null, { ...leadDoFollowup(), status: "won" })).toEqual({ ok: false, erro: "lead_nao_esta_aberto" });
    expect(await voltar(null, { ...leadDoFollowup(), pipeline_id: E })).toEqual({ ok: false, erro: "ja_esta_na_entrada" });
    expect(updates).toEqual([]);
  });
});
