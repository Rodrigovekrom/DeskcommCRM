/**
 * ia.vek v1.9.59.2: tirar o lead do Perdido pede o MOTIVO (regra do Rodrigo: livre para quem move o card, só o
 * porquê), zera o relógio das 72h NA MESMA escrita da etapa (sem isto a esteira passava o lead de novo ao
 * Follow-up: um lead com 4 clones, medido na produção) e devolve as tarefas que a perda cancelou (gatilho 0625).
 *
 * Contra o Route Handler REAL de `POST /api/v1/leads/[id]/move` (auth e Supabase mockados).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import type { AuthUser } from "@/lib/auth/types";
import { moveLeadSchema } from "@/lib/schemas/leads";

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

import { POST } from "@/app/api/v1/leads/[id]/move/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const PIPELINE_ID = "55555555-5555-4555-8555-555555555555";
const PERDIDO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ABERTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA_ABERTA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UPDATED_AT = "2026-11-15T12:00:00.000Z";
const FECHADO_EM = "2026-11-14T10:00:00.000Z";

const ETAPAS: Record<string, Record<string, unknown>> = {
  [PERDIDO]: { id: PERDIDO, pipeline_id: PIPELINE_ID, name: "Perdido", is_lost: true, is_won: false, is_compra_futura: false },
  [ABERTA]: { id: ABERTA, pipeline_id: PIPELINE_ID, name: "Em negociação", is_lost: false, is_won: false, is_compra_futura: false },
  [OUTRA_ABERTA]: { id: OUTRA_ABERTA, pipeline_id: PIPELINE_ID, name: "Novo", is_lost: false, is_won: false, is_compra_futura: false },
};

type Filtro = [string, string, unknown];
interface Chamada {
  tabela: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  filtros: Filtro[];
}

interface Estado {
  lead: Record<string, unknown>;
  chamadas: Chamada[];
  /** O que o banco de serviço devolve para as atividades `task_cancelled`. */
  canceladas: Array<{ source_id: string }>;
  /** As tarefas do lead (id → status), para o update de serviço. */
  tarefas: Record<string, string>;
}

/** Um construtor de consulta encadeável: registra os filtros e responde por `maybeSingle` ou `then`. */
function consulta(estado: Estado, tabela: string, op: Chamada["op"], payload?: Record<string, unknown>) {
  const chamada: Chamada = { tabela, op, payload, filtros: [] };
  estado.chamadas.push(chamada);
  const val = (col: string) => chamada.filtros.find(([, c]) => c === col)?.[2];
  const responder = async (): Promise<{ data: unknown; error: null }> => {
    if (tabela === "crm_leads" && op === "select") return { data: estado.lead, error: null };
    if (tabela === "crm_leads" && op === "update") return { data: { id: LEAD_ID }, error: null };
    if (tabela === "crm_stages") return { data: ETAPAS[String(val("id"))] ?? null, error: null };
    if (tabela === "crm_pipelines") return { data: { settings: {} }, error: null };
    if (tabela === "crm_lead_activities") return { data: estado.canceladas, error: null };
    if (tabela === "crm_tasks" && op === "update") {
      const ids = (val("id") as string[]) ?? [];
      const mudadas = ids.filter((id) => estado.tarefas[id] === "cancelled");
      for (const id of mudadas) estado.tarefas[id] = String(payload?.status);
      return { data: mudadas.map((id) => ({ id })), error: null };
    }
    return { data: null, error: null };
  };
  const qb: Record<string, unknown> = {};
  for (const f of ["eq", "in", "gte"]) {
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
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
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

function leadPerdido(): Record<string, unknown> {
  return {
    id: LEAD_ID,
    organization_id: ORG_ID,
    pipeline_id: PIPELINE_ID,
    stage_id: PERDIDO,
    status: "lost",
    lost_reason: "no_response",
    closed_at: FECHADO_EM,
    updated_at: UPDATED_AT,
    contact_id: "66666666-6666-4666-8666-666666666666",
    source_metadata: { esteira_inicio: "2026-11-01T00:00:00.000Z", esteira_manter_ate: "2026-11-20T00:00:00.000Z", origem: "anuncio" },
  };
}

function pedido(corpo: Record<string, unknown>) {
  return new NextRequest(`http://local/api/v1/leads/${LEAD_ID}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ position_in_stage: 1000, expected_updated_at: UPDATED_AT, ...corpo }),
  });
}

const mover = (corpo: Record<string, unknown>) => POST(pedido(corpo), { params: Promise.resolve({ id: LEAD_ID }) });
const updatesDoLead = (e: Estado) => e.chamadas.filter((c) => c.tabela === "crm_leads" && c.op === "update");

describe("v1.9.59.2: tirar o lead do Perdido pede o motivo", () => {
  let estado: Estado;
  beforeEach(() => {
    vi.mocked(emitLeadActivity).mockClear();
    estado = {
      lead: leadPerdido(),
      chamadas: [],
      canceladas: [{ source_id: "t1" }, { source_id: "t2" }, { source_id: "t1" }],
      tarefas: { t1: "cancelled", t2: "cancelled", t3: "cancelled" },
    };
    sessao(estado);
  });

  it("⭐ sem motivo: 422 `motivo_da_reabertura_obrigatorio`, e o lead não é tocado", async () => {
    const res = await mover({ stage_id: ABERTA });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(corpo.error?.code).toBe("motivo_da_reabertura_obrigatorio");
    expect(corpo.error?.message).toBe("Escreva o motivo para tirar o lead do Perdido.");
    expect(updatesDoLead(estado)).toHaveLength(0);
  });

  it("motivo em branco vale como ausente (o mesmo 422)", async () => {
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: "   " });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error?: { code?: string } };
    expect(corpo.error?.code).toBe("motivo_da_reabertura_obrigatorio");
    expect(updatesDoLead(estado)).toHaveLength(0);
  });

  it("⭐ com motivo: a MESMA escrita da etapa zera o relógio (esteira_inicio novo, sem esteira_manter_ate)", async () => {
    const antes = Date.now();
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: "  O cliente voltou a falar  " });
    expect(res.status).toBe(200);
    const ups = updatesDoLead(estado);
    expect(ups).toHaveLength(1);
    const patch = ups[0]!.payload!;
    expect(patch.stage_id).toBe(ABERTA);
    const meta = patch.source_metadata as Record<string, unknown>;
    expect(meta).not.toHaveProperty("esteira_manter_ate");
    expect(meta.origem).toBe("anuncio");
    expect(Date.parse(String(meta.esteira_inicio))).toBeGreaterThanOrEqual(antes - 1000);
    // a trava otimista segue na escrita
    expect(ups[0]!.filtros).toContainEqual(["eq", "updated_at", UPDATED_AT]);
  });

  it("⭐ com motivo: o stage_changed leva o motivo e nasce a nota 'Reabriu do Perdido', do mesmo ator", async () => {
    await mover({ stage_id: ABERTA, motivo_reabertura: "O cliente voltou a falar" });
    const chamadas = vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1]);
    const etapa = chamadas.find((c) => c.type === "stage_changed");
    expect(etapa?.payload).toMatchObject({ motivo_reabertura: "O cliente voltou a falar" });
    const nota = chamadas.find((c) => c.type === "note");
    expect(nota).toBeDefined();
    expect(nota!.reason).toBe("Reabriu do Perdido: O cliente voltou a falar");
    expect(nota!.actor).toEqual({ type: "user", id: USER_ID });
    expect(nota!.payload).toMatchObject({ motivo_reabertura: "O cliente voltou a falar", de_status: "lost", tarefas_devolvidas: 2 });
    expect(nota!.payload).not.toHaveProperty("carro_voltou");
  });

  it("⭐ com motivo: as tarefas que o gatilho 0625 cancelou desde o fechamento voltam a 'pending'", async () => {
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: "O cliente voltou a falar" });
    const corpo = (await res.json()) as { data?: { tarefas_devolvidas?: number } };
    expect(corpo.data?.tarefas_devolvidas).toBe(2);
    expect(estado.tarefas).toEqual({ t1: "pending", t2: "pending", t3: "cancelled" });

    const atividades = estado.chamadas.find((c) => c.tabela === "crm_lead_activities");
    expect(atividades?.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", ORG_ID],
        ["eq", "lead_id", LEAD_ID],
        ["eq", "type", "task_cancelled"],
        ["eq", "source_module", "tarefas"],
        // o corpo em vigor do gatilho (0639) grava 'gatilho_0639'; o da 0625, 'gatilho_0625'; o primeiro (0621), 'gatilho_0621': as três voltam
        ["in", "metadata->>origem", ["gatilho_0621", "gatilho_0625", "gatilho_0639"]],
        ["gte", "performed_at", FECHADO_EM],
      ]),
    );
    const tarefas = estado.chamadas.find((c) => c.tabela === "crm_tasks");
    expect(tarefas?.payload).toEqual({ status: "pending", cancelada_motivo: null });
    expect(tarefas?.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", ORG_ID],
        ["eq", "lead_id", LEAD_ID],
        ["eq", "status", "cancelled"],
        ["in", "id", ["t1", "t2"]],
      ]),
    );
  });

  it("sem closed_at: reabre, mas não devolve tarefa nenhuma", async () => {
    estado.lead = { ...leadPerdido(), closed_at: null };
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: "O cliente voltou" });
    expect(res.status).toBe(200);
    expect(estado.chamadas.some((c) => c.tabela === "crm_tasks")).toBe(false);
    expect(estado.tarefas.t1).toBe("cancelled");
  });

  it("mover entre etapas ABERTAS: nada muda (sem motivo, sem relógio, sem nota, sem tarefas)", async () => {
    estado.lead = { ...leadPerdido(), status: "open", stage_id: OUTRA_ABERTA, closed_at: null };
    const res = await mover({ stage_id: ABERTA });
    expect(res.status).toBe(200);
    const patch = updatesDoLead(estado)[0]!.payload!;
    expect(patch).not.toHaveProperty("source_metadata");
    const tipos = vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1].type);
    expect(tipos).toEqual(["stage_changed"]);
    expect(estado.chamadas.some((c) => c.tabela === "crm_tasks" || c.tabela === "crm_lead_activities")).toBe(false);
  });

  it("mover PARA o Perdido: segue a regra da perda de sempre (não pede o motivo da reabertura)", async () => {
    estado.lead = { ...leadPerdido(), status: "open", stage_id: ABERTA, closed_at: null, lost_reason: null };
    const res = await mover({ stage_id: PERDIDO, lost_reason: "price" });
    expect(res.status).toBe(200);
    const patch = updatesDoLead(estado)[0]!.payload!;
    expect(patch).toMatchObject({ stage_id: PERDIDO, lost_reason: "price" });
    expect(patch).not.toHaveProperty("source_metadata");
    const tipos = vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1].type);
    expect(tipos).toEqual(["stage_changed"]);
  });

  it("o esquema: motivo aparado, mínimo 3, máximo 500; em branco = ausente", () => {
    const base = { stage_id: ABERTA, position_in_stage: 1, expected_updated_at: UPDATED_AT };
    expect(moveLeadSchema.parse({ ...base, motivo_reabertura: "  abc  " }).motivo_reabertura).toBe("abc");
    expect(moveLeadSchema.parse({ ...base, motivo_reabertura: "" }).motivo_reabertura).toBeUndefined();
    expect(moveLeadSchema.safeParse({ ...base, motivo_reabertura: "ab" }).success).toBe(false);
    expect(moveLeadSchema.safeParse({ ...base, motivo_reabertura: "x".repeat(501) }).success).toBe(false);
  });

  it("os outros caminhos (moveLeadHandler) não exigem o motivo: a exigência é da rota do board", () => {
    const rota = readFileSync("app/api/v1/leads/[id]/move/route.ts", "utf8");
    expect(rota).toMatch(/motivo_da_reabertura_obrigatorio/);
    const handler = readFileSync("app/api/v1/leads/_handler.ts", "utf8");
    expect(handler).not.toMatch(/motivo_da_reabertura_obrigatorio/);
  });
});
