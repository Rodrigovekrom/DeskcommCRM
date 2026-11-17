/**
 * ia.vek v1.9.59.2 (decisão do Rodrigo): reabrir do Perdido um lead que a PASSAGEM das 72h fechou
 * (`moved_to_another_pipeline` + `source_metadata.movido_para.lead_id`) FECHA o clone do Follow-up que ainda está
 * aberto: as tarefas abertas do clone passam ao original (a do dono do clone vira do dono do original) ANTES de o
 * clone fechar (o gatilho 0625/0639 cancelaria todas), e o clone vai ao Perdido do Follow-up com o mesmo motivo da
 * transferência, `voltou_para` e uma nota. Falha aqui não desfaz a reabertura.
 *
 * Contra o Route Handler REAL de `POST /api/v1/leads/[id]/move` e o `encerraDemanda` REAL (auth e Supabase
 * mockados; o banco falso simula o gatilho que cancela as tarefas do lead que fecha).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { conversaSegueODono } from "@/lib/iavek/conversa-segue-o-dono";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { audit } from "@/lib/audit";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/leads/activity-emitter", () => ({
  emitLeadActivity: vi.fn(async () => ({ ok: true })),
  stageChangeReason: vi.fn(() => "razão"),
}));
vi.mock("@/lib/leads/activity-write-failure", () => ({ registraFalhaDeAtividade: vi.fn(async () => undefined) }));
// ia.vek v1.9.60 (Lupa 130153): a conversa segue o dono do lead reaberto, pela regra do CRM-244.
vi.mock("@/lib/iavek/conversa-segue-o-dono", () => ({ conversaSegueODono: vi.fn(async () => true) }));

import { POST } from "@/app/api/v1/leads/[id]/move/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const CLONE_ID = "77777777-7777-4777-8777-777777777777";
const PIPELINE_ID = "55555555-5555-4555-8555-555555555555";
const FU_PIPELINE = "99999999-9999-4999-8999-999999999999";
const OUTRO_PIPELINE = "88888888-8888-4888-8888-888888888888";
const PERDIDO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ABERTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDIDO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FU_ABERTA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FU_PERDIDO = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const DONO_ORIGINAL = "12121212-1212-4212-8212-121212121212";
const DONO_CLONE = "13131313-1313-4313-8313-131313131313";
const OUTRA_PESSOA = "14141414-1414-4414-8414-141414141414";
const CONTATO = "66666666-6666-4666-8666-666666666666";
const UPDATED_AT = "2026-11-15T12:00:00.000Z";
const FECHADO_EM = "2026-11-14T10:00:00.000Z";
const MOTIVO = "O cliente voltou a falar";

const ETAPAS: Array<Record<string, unknown>> = [
  { id: PERDIDO, pipeline_id: PIPELINE_ID, name: "Perdido", is_lost: true, is_won: false, is_compra_futura: false, is_archived: false },
  { id: ABERTA, pipeline_id: PIPELINE_ID, name: "Em negociação", is_lost: false, is_won: false, is_compra_futura: false, is_archived: false },
  { id: VENDIDO, pipeline_id: PIPELINE_ID, name: "Vendido", is_lost: false, is_won: true, is_compra_futura: false, is_archived: false },
  { id: FU_ABERTA, pipeline_id: FU_PIPELINE, name: "Dia 1", is_lost: false, is_won: false, is_compra_futura: false, is_archived: false },
  { id: FU_PERDIDO, pipeline_id: FU_PIPELINE, name: "Perdido FU", is_lost: true, is_won: false, is_compra_futura: false, is_archived: false },
];

type Filtro = [string, string, unknown];
interface Chamada {
  tabela: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  filtros: Filtro[];
}
interface Tarefa {
  lead_id: string;
  status: string;
  assigned_to: string | null;
  source_kind?: string | null;
  created_by?: string | null;
  cancelada_motivo?: string | null;
  title?: string;
}
interface Estado {
  leads: Record<string, Record<string, unknown>>;
  tarefas: Record<string, Tarefa>;
  orgSettings: Record<string, unknown> | null;
  chamadas: Chamada[];
  rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
  /** As linhas inseridas em `crm_lead_activities` (a `task_cancelled` das ligações do clone). */
  atividadesInseridas: Array<Record<string, unknown>>;
  /** Faz o UPDATE do clone falhar (simula a recusa do banco ao fechar o clone). */
  falharFechoDoClone?: boolean;
}

function consulta(estado: Estado, tabela: string, op: Chamada["op"], payload?: Record<string, unknown>) {
  const chamada: Chamada = { tabela, op, payload, filtros: [] };
  estado.chamadas.push(chamada);
  const val = (col: string) => chamada.filtros.find(([, c]) => c === col)?.[2];
  const tem = (col: string) => chamada.filtros.some(([, c]) => c === col);
  const responder = async (): Promise<{ data: unknown; error: { message: string } | null }> => {
    if (tabela === "organizations") return { data: { settings: estado.orgSettings }, error: null };
    if (tabela === "crm_pipelines") return { data: { settings: {} }, error: null };
    if (tabela === "crm_lead_activities") return { data: [], error: null };
    if (tabela === "crm_stages") {
      if (tem("id")) return { data: ETAPAS.find((e) => e.id === val("id")) ?? null, error: null };
      const e = ETAPAS.find(
        (x) => x.pipeline_id === val("pipeline_id") && (val("is_lost") === undefined || x.is_lost === val("is_lost")),
      );
      return { data: e ?? null, error: null };
    }
    if (tabela === "crm_leads" && op === "select") {
      if (!tem("id")) return { data: null, error: null }; // a posição máxima na etapa terminal
      const l = estado.leads[String(val("id"))];
      if (!l) return { data: null, error: null };
      if (tem("organization_id") && val("organization_id") !== l.organization_id) return { data: null, error: null };
      return { data: { ...l }, error: null };
    }
    if (tabela === "crm_leads" && op === "update") {
      const id = String(val("id"));
      const l = estado.leads[id];
      if (!l) return { data: null, error: null };
      if (id === CLONE_ID && estado.falharFechoDoClone) return { data: null, error: { message: "recusado pelo banco" } };
      Object.assign(l, payload);
      const etapa = ETAPAS.find((e) => e.id === payload?.stage_id);
      if (etapa) {
        // fn_crm_lead_close_on_stage + o gatilho 0625/0639 (o lead que FECHA cancela as tarefas abertas)
        l.status = etapa.is_lost ? "lost" : etapa.is_won ? "won" : "open";
        if (etapa.is_lost) {
          for (const t of Object.values(estado.tarefas)) {
            if (t.lead_id === id && (t.status === "pending" || t.status === "in_progress")) t.status = "cancelled";
          }
        }
      }
      return { data: { id }, error: null };
    }
    if (tabela === "crm_tasks") {
      const status = val("status");
      const casa = (t: Tarefa) =>
        t.lead_id === val("lead_id") &&
        (!Array.isArray(status) || status.includes(t.status)) &&
        (typeof status !== "string" || t.status === status);
      if (op === "select") {
        return {
          data: Object.entries(estado.tarefas)
            .filter(([, t]) => casa(t))
            .map(([id, t]) => ({
              id,
              assigned_to: t.assigned_to,
              source_kind: t.source_kind ?? null,
              created_by: t.created_by ?? null,
              title: t.title ?? "Tarefa",
              contact_id: CONTATO,
            })),
          error: null,
        };
      }
      const ids = (val("id") as string[]) ?? [];
      const mudadas = ids.filter((id) => estado.tarefas[id] && casa(estado.tarefas[id]!));
      for (const id of mudadas) Object.assign(estado.tarefas[id]!, payload);
      return { data: mudadas.map((id) => ({ id })), error: null };
    }
    return { data: null, error: null };
  };
  const qb: Record<string, unknown> = {};
  for (const f of ["eq", "in", "gte", "neq"]) {
    qb[f] = (col: string, v: unknown) => {
      chamada.filtros.push([f, col, v]);
      return qb;
    };
  }
  for (const f of ["select", "order", "limit"]) qb[f] = () => qb;
  qb.maybeSingle = responder;
  qb.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => responder().then(ok, erro);
  return qb;
}

function cliente(estado: Estado) {
  return {
    from: (tabela: string) => ({
      select: () => consulta(estado, tabela, "select"),
      update: (payload: Record<string, unknown>) => consulta(estado, tabela, "update", payload),
      insert: (linhas: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (tabela === "crm_lead_activities") estado.atividadesInseridas.push(...[linhas].flat());
        return Promise.resolve({ data: null, error: null });
      },
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      estado.rpcs.push({ fn, args });
      if (fn === "fn_iavek_mesclar_source_metadata") {
        const l = estado.leads[String(args.p_lead)];
        if (!l || l.organization_id !== args.p_org) return Promise.resolve({ data: false, error: null });
        l.source_metadata = { ...((l.source_metadata as Record<string, unknown>) ?? {}), ...(args.p_patch as Record<string, unknown>) };
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function sessao(estado: Estado) {
  const user: AuthUser = {
    id: USER_ID,
    email: "a@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "agent" }],
  };
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({ ok: true, user, org: { orgId: ORG_ID, name: "Org", role: "agent" } } as never);
  vi.mocked(createClient).mockResolvedValue(cliente(estado) as never);
  vi.mocked(createAdminClient).mockReturnValue(cliente(estado) as never);
}

function original(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LEAD_ID,
    organization_id: ORG_ID,
    pipeline_id: PIPELINE_ID,
    stage_id: PERDIDO,
    status: "lost",
    lost_reason: "moved_to_another_pipeline",
    closed_at: FECHADO_EM,
    updated_at: UPDATED_AT,
    owner_user_id: DONO_ORIGINAL,
    contact_id: CONTATO,
    source_metadata: {
      esteira_inicio: "2026-11-01T00:00:00.000Z",
      movido_para: { lead_id: CLONE_ID, pipeline_id: FU_PIPELINE, stage_id: FU_ABERTA },
    },
    ...extra,
  };
}

function clone(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CLONE_ID,
    organization_id: ORG_ID,
    pipeline_id: FU_PIPELINE,
    stage_id: FU_ABERTA,
    status: "open",
    lost_reason: null,
    updated_at: UPDATED_AT,
    owner_user_id: DONO_CLONE,
    contact_id: CONTATO,
    source_metadata: { clonado_de: LEAD_ID },
    ...extra,
  };
}

function estadoInicial(): Estado {
  return {
    leads: { [LEAD_ID]: original(), [CLONE_ID]: clone() },
    tarefas: {
      // manuais (de gente)
      tc1: { lead_id: CLONE_ID, status: "pending", assigned_to: DONO_CLONE, created_by: DONO_CLONE },
      tc2: { lead_id: CLONE_ID, status: "in_progress", assigned_to: OUTRA_PESSOA, created_by: OUTRA_PESSOA },
      tc3: { lead_id: CLONE_ID, status: "done", assigned_to: DONO_CLONE, created_by: DONO_CLONE },
      // o retorno combinado nasce do registro de uma pessoa: segue com o lead, como as manuais
      tc4: { lead_id: CLONE_ID, status: "pending", assigned_to: DONO_CLONE, created_by: null, source_kind: "ligacao:retorno" },
      // as ligações AUTOMÁTICAS do Follow-up (a rodada da esteira, created_by null)
      l4: { lead_id: CLONE_ID, status: "pending", assigned_to: DONO_CLONE, created_by: null, source_kind: "ligacao:L4", title: "Ligar (L4)" },
      l5: { lead_id: CLONE_ID, status: "in_progress", assigned_to: DONO_CLONE, created_by: null, source_kind: "ligacao:L5", title: "Ligar (L5)" },
      // a L6 já feita não é tocada
      l6: { lead_id: CLONE_ID, status: "done", assigned_to: DONO_CLONE, created_by: null, source_kind: "ligacao:L6" },
    },
    orgSettings: { esteira: { ativa: true, followup: { pipeline_id: FU_PIPELINE } } },
    chamadas: [],
    rpcs: [],
    atividadesInseridas: [],
  };
}

function pedido(corpo: Record<string, unknown>) {
  return new NextRequest(`http://local/api/v1/leads/${LEAD_ID}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ position_in_stage: 1000, expected_updated_at: UPDATED_AT, ...corpo }),
  });
}

const reabrir = () =>
  POST(pedido({ stage_id: ABERTA, motivo_reabertura: MOTIVO }), { params: Promise.resolve({ id: LEAD_ID }) });

const notas = () => vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1]).filter((c) => c.type === "note");
const tocouOClone = (e: Estado) =>
  e.chamadas.some(
    (c) =>
      (c.tabela === "crm_tasks" && c.op === "update") ||
      (c.tabela === "crm_leads" && c.op === "update" && c.filtros.some(([, col, v]) => col === "id" && v === CLONE_ID)),
  );

describe("v1.9.59.2: reabrir do Perdido da passagem fecha o clone do Follow-up", () => {
  let estado: Estado;
  let erroNoLog: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.mocked(emitLeadActivity).mockClear();
    vi.mocked(audit).mockClear();
    estado = estadoInicial();
    sessao(estado);
    erroNoLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => erroNoLog.mockRestore());

  it("⭐ o clone aberto fecha no Perdido do Follow-up, com moved_to_another_pipeline e voltou_para", async () => {
    const res = await reabrir();
    expect(res.status).toBe(200);
    const c = estado.leads[CLONE_ID]!;
    expect(c.status).toBe("lost");
    expect(c.stage_id).toBe(FU_PERDIDO);
    expect(c.lost_reason).toBe("moved_to_another_pipeline");
    const voltou = (c.source_metadata as Record<string, unknown>).voltou_para as Record<string, unknown>;
    expect(voltou).toMatchObject({ lead_id: LEAD_ID, por: "reabertura" });
    expect(Number.isNaN(Date.parse(String(voltou.em)))).toBe(false);
    expect((c.source_metadata as Record<string, unknown>).clonado_de).toBe(LEAD_ID);
    // o original reabriu
    expect(estado.leads[LEAD_ID]!.status).toBe("open");
    expect(estado.leads[LEAD_ID]!.stage_id).toBe(ABERTA);
  });

  it("⭐ as tarefas abertas do clone passam ao original ANTES do fecho (a do dono do clone vira do dono do original)", async () => {
    await reabrir();
    expect(estado.tarefas.tc1).toMatchObject({ lead_id: LEAD_ID, status: "pending", assigned_to: DONO_ORIGINAL });
    expect(estado.tarefas.tc2).toMatchObject({ lead_id: LEAD_ID, status: "in_progress", assigned_to: OUTRA_PESSOA });
    expect(estado.tarefas.tc4).toMatchObject({ lead_id: LEAD_ID, status: "pending", assigned_to: DONO_ORIGINAL });
    // a feita fica no clone, intocada
    expect(estado.tarefas.tc3).toMatchObject({ lead_id: CLONE_ID, status: "done", assigned_to: DONO_CLONE });
    // toda escrita de serviço nas tarefas filtra organização e o clone
    const ups = estado.chamadas.filter((c) => c.tabela === "crm_tasks" && c.op === "update");
    expect(ups).toHaveLength(3); // cancelar as automáticas + as duas mudanças de lead
    for (const u of ups) {
      expect(u.filtros).toEqual(
        expect.arrayContaining([
          ["eq", "organization_id", ORG_ID],
          ["eq", "lead_id", CLONE_ID],
          ["in", "status", ["pending", "in_progress"]],
        ]),
      );
    }
  });

  it("⭐ resposta e audit dizem clone_fechado e tarefas_do_clone; a nota do original leva o id do clone", async () => {
    const res = await reabrir();
    const corpo = (await res.json()) as { data?: Record<string, unknown> };
    expect(corpo.data).toMatchObject({ clone_fechado: true, tarefas_do_clone: 3, ligacoes_canceladas: 2 });
    const lidoDoMove = vi
      .mocked(audit)
      .mock.calls.map((c) => c[0])
      .find((a) => a.action === "lead.moved");
    expect(lidoDoMove?.metadata).toMatchObject({
      reabriu_do_perdido: true,
      clone_fechado: true,
      tarefas_do_clone: 3,
      ligacoes_canceladas: 2,
    });
    const notaDoOriginal = notas().find((n) => n.leadId === LEAD_ID);
    expect(notaDoOriginal?.payload).toMatchObject({ clone_fechado: CLONE_ID, tarefas_do_clone: 3, ligacoes_canceladas: 2 });
  });

  it("⭐ o clone ganha a nota 'Fechado: o lead original foi reaberto (motivo: …)', do mesmo ator", async () => {
    await reabrir();
    const notaDoClone = notas().find((n) => n.leadId === CLONE_ID);
    expect(notaDoClone).toBeDefined();
    expect(notaDoClone!.reason).toBe(`Fechado: o lead original foi reaberto (motivo: ${MOTIVO})`);
    expect(notaDoClone!.organizationId).toBe(ORG_ID);
    expect(notaDoClone!.actor).toEqual({ type: "user", id: USER_ID });
    // e o fecho do clone tem a linha de desfecho do encerraDemanda
    const desfecho = vi
      .mocked(emitLeadActivity)
      .mock.calls.map((c) => c[1])
      .find((c) => c.type === "demand_closed" && c.leadId === CLONE_ID);
    expect(desfecho?.reason).toBe("Fechado: o lead original foi reaberto");
  });

  it("⭐ a CONVERSA segue o dono do lead reaberto (regra do CRM-244), e a nota do clone diz que passou", async () => {
    vi.mocked(conversaSegueODono).mockClear();
    await reabrir();
    expect(conversaSegueODono).toHaveBeenCalledTimes(1);
    expect(vi.mocked(conversaSegueODono).mock.calls[0]![1]).toMatchObject({ contactId: CONTATO, novoDono: DONO_ORIGINAL });
    const notaDoClone = vi.mocked(emitLeadActivity).mock.calls.find(
      (c) => (c[1] as { leadId?: string }).leadId === CLONE_ID && (c[1] as { type?: string }).type === "note",
    );
    expect((notaDoClone?.[1] as { payload?: Record<string, unknown> }).payload?.conversa_passou).toBe(true);
  });

  it("clone já perdido: nada é feito, clone_fechado false", async () => {
    estado.leads[CLONE_ID] = clone({ status: "lost", stage_id: FU_PERDIDO, lost_reason: "no_response" });
    const res = await reabrir();
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data?: Record<string, unknown> };
    expect(corpo.data).toMatchObject({ clone_fechado: false, tarefas_do_clone: 0, ligacoes_canceladas: 0 });
    expect(tocouOClone(estado)).toBe(false);
    expect(estado.tarefas.tc1!.lead_id).toBe(CLONE_ID);
    expect(estado.tarefas.l4!.status).toBe("pending");
    expect(estado.leads[CLONE_ID]!.lost_reason).toBe("no_response");
  });

  it("perdido por OUTRO motivo (não a passagem): nem procura o clone", async () => {
    estado.leads[LEAD_ID] = original({ lost_reason: "no_response" });
    const res = await reabrir();
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data?: Record<string, unknown> };
    expect(corpo.data).toMatchObject({ clone_fechado: false, tarefas_do_clone: 0 });
    expect(estado.chamadas.some((c) => c.tabela === "organizations")).toBe(false);
    expect(tocouOClone(estado)).toBe(false);
    expect(estado.leads[CLONE_ID]!.status).toBe("open");
  });

  it("reabrir do VENDIDO: o clone não é tocado", async () => {
    estado.leads[LEAD_ID] = original({ status: "won", stage_id: VENDIDO });
    const res = await reabrir();
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data?: Record<string, unknown> };
    expect(corpo.data).not.toHaveProperty("clone_fechado");
    expect(estado.chamadas.some((c) => c.tabela === "organizations")).toBe(false);
    expect(tocouOClone(estado)).toBe(false);
    expect(estado.leads[CLONE_ID]!.status).toBe("open");
  });

  it("organização sem a esteira configurada: o clone não é tocado", async () => {
    estado.orgSettings = {};
    const corpo = (await (await reabrir()).json()) as { data?: Record<string, unknown> };
    expect(corpo.data).toMatchObject({ clone_fechado: false });
    expect(tocouOClone(estado)).toBe(false);
  });

  it("clone fora do funil de Follow-up: o clone não é tocado", async () => {
    estado.leads[CLONE_ID] = clone({ pipeline_id: OUTRO_PIPELINE });
    const corpo = (await (await reabrir()).json()) as { data?: Record<string, unknown> };
    expect(corpo.data).toMatchObject({ clone_fechado: false });
    expect(tocouOClone(estado)).toBe(false);
  });

  it("⭐ as ligações AUTOMÁTICAS do Follow-up no clone são canceladas com o motivo, e não vão para o original", async () => {
    await reabrir();
    expect(estado.tarefas.l4).toMatchObject({ lead_id: CLONE_ID, status: "cancelled", cancelada_motivo: "lead_voltou_ao_vendedor" });
    expect(estado.tarefas.l5).toMatchObject({ lead_id: CLONE_ID, status: "cancelled", cancelada_motivo: "lead_voltou_ao_vendedor" });
    expect(estado.tarefas.l6).toMatchObject({ lead_id: CLONE_ID, status: "done" });
    expect(estado.tarefas.l6).not.toHaveProperty("cancelada_motivo");
    // o cancelamento filtra organização, o clone e as abertas
    const cancelar = estado.chamadas.find((c) => c.tabela === "crm_tasks" && c.op === "update" && c.payload?.status === "cancelled");
    expect(cancelar?.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", ORG_ID],
        ["eq", "lead_id", CLONE_ID],
        ["in", "status", ["pending", "in_progress"]],
        ["in", "id", ["l4", "l5"]],
      ]),
    );
  });

  it("⭐ cada ligação cancelada deixa a linha task_cancelled (como os gatilhos), com origem que a devolução NÃO aceita", async () => {
    await reabrir();
    expect(estado.atividadesInseridas).toHaveLength(2);
    for (const [i, id] of ["l4", "l5"].entries()) {
      const linha = estado.atividadesInseridas[i]!;
      expect(linha).toMatchObject({
        organization_id: ORG_ID,
        lead_id: CLONE_ID,
        contact_id: CONTATO,
        source_module: "tarefas",
        source_id: id,
        type: "task_cancelled",
        actor_kind: "rule",
        reason: "Ligação cancelada: o lead voltou ao vendedor",
        metadata: { origem: "reabertura_fecha_clone" },
      });
      expect(linha.payload).toMatchObject({ motivo: "lead_voltou_ao_vendedor", lead_original: LEAD_ID });
      expect(linha).not.toHaveProperty("performed_at");
    }
    // a devolução das tarefas da perda (do ORIGINAL) só aceita as origens dos gatilhos de fechamento
    const devolucao = estado.chamadas.find((c) => c.tabela === "crm_lead_activities" && c.op === "select");
    const origens = devolucao?.filtros.find(([, col]) => col === "metadata->>origem")?.[2] as string[];
    expect(origens).toEqual(["gatilho_0621", "gatilho_0625", "gatilho_0639"]);
    expect(origens).not.toContain("reabertura_fecha_clone");
  });

  it("uma ligacao:L* criada por gente (created_by preenchido) conta como manual e vai para o original", async () => {
    estado.tarefas.l4 = { ...estado.tarefas.l4!, created_by: OUTRA_PESSOA };
    const corpo = (await (await reabrir()).json()) as { data?: Record<string, unknown> };
    expect(estado.tarefas.l4).toMatchObject({ lead_id: LEAD_ID, status: "pending" });
    expect(corpo.data).toMatchObject({ tarefas_do_clone: 4, ligacoes_canceladas: 1 });
  });

  it("⭐ falha ao fechar o clone: a reabertura segue 200, o erro vai ao log e a resposta diz clone_fechado false", async () => {
    estado.falharFechoDoClone = true;
    const res = await reabrir();
    expect(res.status).toBe(200);
    expect(estado.leads[LEAD_ID]!.status).toBe("open");
    const corpo = (await res.json()) as { data?: Record<string, unknown> };
    expect(corpo.data?.clone_fechado).toBe(false);
    // as tarefas já tinham ido ao original (não se perdem), e a conta diz quantas
    expect(corpo.data?.tarefas_do_clone).toBe(3);
    expect(corpo.data?.ligacoes_canceladas).toBe(2);
    expect(estado.tarefas.tc1!.lead_id).toBe(LEAD_ID);
    expect(estado.leads[CLONE_ID]!.status).toBe("open");
    expect(erroNoLog).toHaveBeenCalledWith(
      "[lead.move] fechar o clone da passagem falhou",
      expect.objectContaining({ lead_id: LEAD_ID, clone_id: CLONE_ID }),
    );
    expect(notas().some((n) => n.leadId === CLONE_ID)).toBe(false);
  });
});
