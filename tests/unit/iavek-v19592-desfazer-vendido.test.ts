/**
 * ia.vek v1.9.59.2 — DESFAZER DEPOIS DE VENDIDO (regra do Rodrigo): tirar o lead do Vendido para uma etapa ABERTA
 * pede o MOTIVO (o mesmo `motivo_da_reabertura_obrigatorio` do Perdido), zera o relógio das 72h na mesma escrita,
 * grava a nota "Reabriu do Vendido", devolve as tarefas que a venda cancelou e devolve o CARRO ao estoque (tira o
 * carimbo `aviso_da_loja_em` da 0608) quando é o mesmo carro, ainda ativo, e nenhum outro lead o vendeu. Valor e
 * data da venda não são tocados pela rota (a trava "só gerente corrige" da 0608 segue no banco).
 *
 * Contra o Route Handler REAL de `POST /api/v1/leads/[id]/move` (auth e Supabase mockados).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
vi.mock("@/lib/iavek/venda-da-loja-servidor", () => ({ lojaPedeDadosDaVenda: vi.fn(async () => false) }));

import { POST } from "@/app/api/v1/leads/[id]/move/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "44444444-4444-4444-8444-444444444444";
const PIPELINE_ID = "55555555-5555-4555-8555-555555555555";
const CARRO = "77777777-7777-4777-8777-777777777777";
const VENDIDO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VENDIDO_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PERDIDO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ABERTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPDATED_AT = "2026-11-15T12:00:00.000Z";
const VENDIDO_EM = "2026-11-14T10:00:00.000Z";

const ETAPAS: Record<string, Record<string, unknown>> = {
  [VENDIDO]: { id: VENDIDO, pipeline_id: PIPELINE_ID, name: "Vendido", is_lost: false, is_won: true, is_compra_futura: false },
  [VENDIDO_2]: { id: VENDIDO_2, pipeline_id: PIPELINE_ID, name: "Entregue", is_lost: false, is_won: true, is_compra_futura: false },
  [PERDIDO]: { id: PERDIDO, pipeline_id: PIPELINE_ID, name: "Perdido", is_lost: true, is_won: false, is_compra_futura: false },
  [ABERTA]: { id: ABERTA, pipeline_id: PIPELINE_ID, name: "Em negociação", is_lost: false, is_won: false, is_compra_futura: false },
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
  canceladas: Array<{ source_id: string }>;
  tarefas: Record<string, string>;
  /** O carro no catálogo (null = não existe/não é do Altimus desta organização). */
  carro: { id: string; ativo: boolean; aviso_da_loja_em: string | null } | null;
  /** Os OUTROS leads 'won' com o mesmo carro. */
  outrosVendidos: Array<{ id: string }>;
}

function consulta(estado: Estado, tabela: string, op: Chamada["op"], payload?: Record<string, unknown>) {
  const chamada: Chamada = { tabela, op, payload, filtros: [] };
  estado.chamadas.push(chamada);
  const val = (col: string) => chamada.filtros.find(([, c]) => c === col)?.[2];
  const responder = async (): Promise<{ data: unknown; error: null }> => {
    if (tabela === "crm_leads" && op === "select") {
      if (val("status") === "won") return { data: estado.outrosVendidos, error: null };
      return { data: estado.lead, error: null };
    }
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
    if (tabela === "catalog_products" && op === "select") {
      const c = estado.carro;
      const casa = c && val("id") === c.id && val("organization_id") === ORG_ID && val("origem") === "altimus";
      return { data: casa ? { id: c.id, ativo: c.ativo } : null, error: null };
    }
    if (tabela === "catalog_products" && op === "update") {
      const c = estado.carro;
      if (c && val("id") === c.id && val("organization_id") === ORG_ID && c.ativo === val("ativo")) {
        Object.assign(c, payload);
      }
      return { data: null, error: null };
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
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "manager" }],
  };
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({ ok: true, user, org: { orgId: ORG_ID, name: "Org", role: "manager" } } as never);
  vi.mocked(createClient).mockResolvedValue(cliente(estado) as never);
  vi.mocked(createAdminClient).mockReturnValue(cliente(estado) as never);
}

function leadVendido(): Record<string, unknown> {
  return {
    id: LEAD_ID,
    organization_id: ORG_ID,
    pipeline_id: PIPELINE_ID,
    stage_id: VENDIDO,
    status: "won",
    value_cents: 8_500_000,
    won_reason: "preço",
    closed_at: VENDIDO_EM,
    updated_at: UPDATED_AT,
    contact_id: "66666666-6666-4666-8666-666666666666",
    custom_fields: { carro_interesse: CARRO },
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
const updatesDoCarro = (e: Estado) => e.chamadas.filter((c) => c.tabela === "catalog_products" && c.op === "update");
const MOTIVO = "O financiamento foi negado";

describe("v1.9.59.2: desfazer depois de vendido", () => {
  let estado: Estado;
  beforeEach(() => {
    vi.mocked(emitLeadActivity).mockClear();
    vi.mocked(audit).mockClear();
    estado = {
      lead: leadVendido(),
      chamadas: [],
      canceladas: [{ source_id: "t1" }],
      tarefas: { t1: "cancelled", t2: "pending" },
      carro: { id: CARRO, ativo: true, aviso_da_loja_em: VENDIDO_EM },
      outrosVendidos: [],
    };
    sessao(estado);
  });

  it("⭐ Vendido → aberta SEM motivo: 422 `motivo_da_reabertura_obrigatorio` (frase do Vendido), nada é tocado", async () => {
    const res = await mover({ stage_id: ABERTA });
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    expect(corpo.error?.code).toBe("motivo_da_reabertura_obrigatorio");
    expect(corpo.error?.message).toBe("Escreva o motivo para tirar o lead do Vendido.");
    expect(corpo.error?.details).toMatchObject({ de_status: "won" });
    expect(updatesDoLead(estado)).toHaveLength(0);
    expect(updatesDoCarro(estado)).toHaveLength(0);
  });

  it("⭐ COM motivo: 200, relógio zerado na mesma escrita, venda intocada, nota 'Reabriu do Vendido' com de_status", async () => {
    const antes = Date.now();
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: `  ${MOTIVO}  ` });
    expect(res.status).toBe(200);
    const ups = updatesDoLead(estado);
    expect(ups).toHaveLength(1);
    const patch = ups[0]!.payload!;
    expect(patch.stage_id).toBe(ABERTA);
    const meta = patch.source_metadata as Record<string, unknown>;
    expect(meta).not.toHaveProperty("esteira_manter_ate");
    expect(meta.origem).toBe("anuncio");
    expect(Date.parse(String(meta.esteira_inicio))).toBeGreaterThanOrEqual(antes - 1000);
    // valor, data e motivo da venda: a rota não escreve (o gatilho 0600 devolve o preço do estoque ao lead aberto)
    for (const campo of ["value_cents", "closed_at", "won_reason", "status"]) expect(patch).not.toHaveProperty(campo);
    expect(ups[0]!.filtros).toContainEqual(["eq", "updated_at", UPDATED_AT]);

    const chamadas = vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1]);
    expect(chamadas.find((c) => c.type === "stage_changed")?.payload).toMatchObject({
      motivo_reabertura: MOTIVO,
      de_status: "won",
    });
    const nota = chamadas.find((c) => c.type === "note");
    expect(nota?.reason).toBe(`Reabriu do Vendido: ${MOTIVO}`);
    expect(nota?.actor).toEqual({ type: "user", id: USER_ID });
    expect(nota?.payload).toMatchObject({ motivo_reabertura: MOTIVO, de_status: "won", tarefas_devolvidas: 1, carro_voltou: true });

    // as tarefas que a venda cancelou (pré-venda, gatilho 0625/0639) voltam
    expect(estado.tarefas).toEqual({ t1: "pending", t2: "pending" });
    const atividades = estado.chamadas.find((c) => c.tabela === "crm_lead_activities");
    expect(atividades?.filtros).toEqual(
      expect.arrayContaining([
        ["in", "metadata->>origem", ["gatilho_0621", "gatilho_0625", "gatilho_0639"]],
        ["gte", "performed_at", VENDIDO_EM],
      ]),
    );

    const corpo = (await res.json()) as { data?: { carro_voltou?: boolean; tarefas_devolvidas?: number } };
    expect(corpo.data).toMatchObject({ carro_voltou: true, tarefas_devolvidas: 1 });
    expect(vi.mocked(audit).mock.calls[0]![0].metadata).toMatchObject({
      reabriu_do_vendido: true,
      carro_voltou: true,
      tarefas_devolvidas: 1,
    });
  });

  it("⭐ o carro VOLTA ao estoque: ativo e sem outro lead vendido com ele → aviso_da_loja_em = null (filtrado pela organização)", async () => {
    await mover({ stage_id: ABERTA, motivo_reabertura: MOTIVO });
    expect(estado.carro?.aviso_da_loja_em).toBeNull();
    const up = updatesDoCarro(estado);
    expect(up).toHaveLength(1);
    expect(up[0]!.payload).toEqual({ aviso_da_loja_em: null });
    expect(up[0]!.filtros).toEqual(expect.arrayContaining([["eq", "organization_id", ORG_ID], ["eq", "id", CARRO]]));
    const outros = estado.chamadas.find((c) => c.tabela === "crm_leads" && c.filtros.some(([, col, v]) => col === "status" && v === "won"));
    expect(outros?.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "organization_id", ORG_ID],
        ["eq", "custom_fields->>carro_interesse", CARRO],
        ["neq", "id", LEAD_ID],
      ]),
    );
  });

  it("⭐ o carro NÃO volta quando OUTRO lead já está vendido com ele", async () => {
    estado.outrosVendidos = [{ id: "99999999-9999-4999-8999-999999999999" }];
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: MOTIVO });
    expect(res.status).toBe(200);
    expect(updatesDoCarro(estado)).toHaveLength(0);
    expect(estado.carro?.aviso_da_loja_em).toBe(VENDIDO_EM);
    const corpo = (await res.json()) as { data?: { carro_voltou?: boolean } };
    expect(corpo.data?.carro_voltou).toBe(false);
  });

  it("⭐ o carro NÃO volta quando está INATIVO (saiu do Altimus: a 0600 tira a marca quando ele voltar)", async () => {
    estado.carro = { id: CARRO, ativo: false, aviso_da_loja_em: VENDIDO_EM };
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: MOTIVO });
    expect(res.status).toBe(200);
    expect(updatesDoCarro(estado)).toHaveLength(0);
    expect(estado.carro.aviso_da_loja_em).toBe(VENDIDO_EM);
    const corpo = (await res.json()) as { data?: { carro_voltou?: boolean } };
    expect(corpo.data?.carro_voltou).toBe(false);
  });

  it("sem carro (ou carro que não é uuid): reabre, e o catálogo nem é consultado", async () => {
    estado.lead = { ...leadVendido(), custom_fields: { carro_interesse: "Gol 2015" } };
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: MOTIVO });
    expect(res.status).toBe(200);
    expect(estado.chamadas.some((c) => c.tabela === "catalog_products")).toBe(false);
  });

  it("⭐ reordenar a coluna Vendido e andar entre etapas de venda: nada muda (sem motivo, sem relógio, sem carro)", async () => {
    for (const destino of [VENDIDO, VENDIDO_2]) {
      vi.mocked(emitLeadActivity).mockClear();
      estado.chamadas = [];
      const res = await mover({ stage_id: destino });
      expect(res.status).toBe(200);
      const patch = updatesDoLead(estado)[0]!.payload!;
      expect(patch).not.toHaveProperty("source_metadata");
      expect(vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1].type)).toEqual(["stage_changed"]);
      expect(vi.mocked(emitLeadActivity).mock.calls[0]![1].payload).not.toHaveProperty("motivo_reabertura");
      expect(estado.chamadas.some((c) => c.tabela === "catalog_products" || c.tabela === "crm_tasks")).toBe(false);
      const corpo = (await res.json()) as { data?: Record<string, unknown> };
      expect(corpo.data).not.toHaveProperty("carro_voltou");
    }
  });

  it("o caminho do Perdido segue o mesmo: frase do Perdido, nota 'Reabriu do Perdido', sem carro", async () => {
    estado.lead = { ...leadVendido(), stage_id: PERDIDO, status: "lost", lost_reason: "price" };
    const sem = await mover({ stage_id: ABERTA });
    expect(((await sem.json()) as { error?: { message?: string } }).error?.message).toBe(
      "Escreva o motivo para tirar o lead do Perdido.",
    );
    const res = await mover({ stage_id: ABERTA, motivo_reabertura: "O cliente voltou" });
    expect(res.status).toBe(200);
    const nota = vi.mocked(emitLeadActivity).mock.calls.map((c) => c[1]).find((c) => c.type === "note");
    expect(nota?.reason).toBe("Reabriu do Perdido: O cliente voltou");
    expect(nota?.payload).toMatchObject({ de_status: "lost" });
    expect(estado.chamadas.some((c) => c.tabela === "catalog_products")).toBe(false);
    const corpo = (await res.json()) as { data?: Record<string, unknown> };
    expect(corpo.data).not.toHaveProperty("carro_voltou");
    expect(vi.mocked(audit).mock.calls.at(-1)![0].metadata).toMatchObject({ reabriu_do_perdido: true });
  });
});
