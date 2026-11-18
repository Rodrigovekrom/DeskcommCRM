/**
 * ia.vek CRM-536 (Lupa 224954): o painel das 72h passa a mostrar "Agendar horário" para TODOS que atendem e o relógio
 * das 72h vira o "Manter por mais 72h". A tela só mostra; quem decide é a ROTA. Estes testes chamam as rotas de
 * verdade (POST), com a sessão e o banco de mentira, e provam por papel:
 *   - /api/v1/iavek/pedidos-de-agendamento: quem só VISUALIZA é recusado; na clínica (sem marcar direto), a SDR cai no
 *     PEDIDO pendente; na loja, ninguém cria pedido pendente (o vendedor marca para si, e os outros escolhem o
 *     vendedor: 422);
 *   - /api/v1/iavek/esteira/manter: o 403 para quem não é o dono, o guardião, o gerente nem o admin, mesmo chamando a
 *     rota direto; quem só visualiza é recusado antes de ler o lead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  papel: "agent" as string,
  eu: "u-eu",
  marcaDireto: false,
  vendedores: [] as Array<{ id: string }>,
  lead: null as Record<string, unknown> | null,
  atualizou: 0,
  pediuMinimo: [] as string[],
}));

vi.mock("@/lib/auth/require-role", async () => {
  const { roleAtLeast } = await import("@/lib/auth/types");
  return {
    requireRole: vi.fn(async (min: string) => {
      estado.pediuMinimo.push(min);
      if (!roleAtLeast(estado.papel, min as never)) {
        return {
          ok: false,
          response: new Response(JSON.stringify({ error: { code: "forbidden_role" } }), {
            status: 403,
          }),
        };
      }
      return {
        ok: true,
        user: { id: estado.eu, idioma: "pt-BR" },
        org: { orgId: "org-1", role: estado.papel },
      };
    }),
  };
});
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/iavek/sdr-marca-direto", () => ({
  marcaDiretoNaLoja: vi.fn(async () => ({ marcaDireto: estado.marcaDireto, ehSdr: true })),
  vendedoresDaLoja: vi.fn(async () => estado.vendedores),
}));
const gravar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/iavek/pedidos-de-agendamento", async (orig) => ({
  ...(await orig<typeof import("@/lib/iavek/pedidos-de-agendamento")>()),
  gravarPedidoDeAgendamento: gravar,
}));

/** O banco de mentira: o lead da sessão, a organização com as 72h e o update contado. */
function cadeia(data: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data, error: null });
  c.update = () => {
    estado.atualizou += 1;
    return c;
  };
  c.then = (res: (v: unknown) => unknown) => res({ data: null, error: null });
  return c;
}
const ENTRADA = {
  esteira: {
    ativa: true,
    entrada: {
      pipeline_id: "22222222-2222-4222-8222-222222222222",
      horas: 72,
      etapas_de_compromisso: ["33333333-3333-4333-8333-333333333333"],
    },
  },
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: () => cadeia(estado.lead) })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: (t: string) => (t === "organizations" ? cadeia({ settings: ENTRADA }) : cadeia(null)),
  })),
}));

import { POST as pedir } from "@/app/api/v1/iavek/pedidos-de-agendamento/route";
import { POST as manter } from "@/app/api/v1/iavek/esteira/manter/route";

const ID = "11111111-1111-4111-8111-111111111111";
const corpo = (o: unknown) =>
  new Request("http://x", {
    method: "POST",
    body: JSON.stringify(o),
    headers: { "content-type": "application/json" },
  }) as never;
const PEDIDO = { contact_id: ID, lead_id: ID, quando: "2026-11-20T15:00:00.000Z" };

beforeEach(() => {
  estado.papel = "agent";
  estado.eu = "u-eu";
  estado.marcaDireto = false;
  estado.vendedores = [];
  estado.atualizou = 0;
  estado.pediuMinimo = [];
  gravar.mockReset();
  gravar.mockResolvedValue({ ok: true, pedido: { id: "pedido-1", status: "pendente" } });
  estado.lead = {
    id: ID,
    status: "open",
    pipeline_id: "22222222-2222-4222-8222-222222222222",
    stage_id: "novo",
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
    source_metadata: {},
    owner_user_id: "u-dono",
    sdr_user_id: "u-guardiao",
  };
});

describe("CRM-536: 'Agendar horário' para todos que atendem (a rota decide)", () => {
  it("quem só VISUALIZA (viewer) é recusado: 403 e nada gravado; a rota pede no mínimo 'agent'", async () => {
    estado.papel = "viewer";
    const r = await pedir(corpo(PEDIDO));
    expect(r.status).toBe(403);
    expect(estado.pediuMinimo).toEqual(["agent"]);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("na clínica (não marca direto), a SDR que agenda cai no PEDIDO pendente", async () => {
    estado.marcaDireto = false;
    const r = await pedir(corpo(PEDIDO));
    expect(r.status).toBe(201);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(gravar.mock.calls[0]![1]).toMatchObject({ origem: "pessoa", pedidoPor: "u-eu" });
  });

  it("na loja (marca direto), quem não é vendedor e não escolheu o vendedor: 422, e NUNCA um pedido pendente", async () => {
    estado.marcaDireto = true;
    estado.vendedores = [{ id: "u-vendedor" }];
    const r = await pedir(corpo(PEDIDO));
    expect(r.status).toBe(422);
    expect(gravar).not.toHaveBeenCalled();
  });
});

describe("CRM-536: o relógio 'Manter por mais 72h' (a rota recusa quem não pode)", () => {
  it("quem só VISUALIZA é recusado antes de ler o lead", async () => {
    estado.papel = "viewer";
    const r = await manter(corpo({ lead_id: ID }));
    expect(r.status).toBe(403);
    expect(estado.atualizou).toBe(0);
  });

  it("um atendente que não é o dono nem o guardião: 403, chamando a rota direto, e nada muda", async () => {
    estado.eu = "u-outro";
    const r = await manter(corpo({ lead_id: ID }));
    expect(r.status).toBe(403);
    expect(estado.atualizou).toBe(0);
  });

  for (const [quem, eu, papel] of [
    ["o dono", "u-dono", "agent"],
    ["o guardião", "u-guardiao", "agent"],
    ["o gerente", "u-outro", "manager"],
    ["o admin", "u-outro", "admin"],
  ] as const) {
    it(`${quem} mantém: 200 e o lead ganha mais 72h`, async () => {
      estado.eu = eu;
      estado.papel = papel;
      const r = await manter(corpo({ lead_id: ID }));
      expect(r.status).toBe(200);
      expect(estado.atualizou).toBe(1);
    });
  }
});
