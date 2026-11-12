/**
 * ia.vek v1.9.48 — "LIVRE PARA TODOS" (decisão do Rodrigo, Notion 12/11 12:48Z, Maestro 125050), pelo COMPORTAMENTO da
 * rota POST /api/v1/iavek/pedidos-de-agendamento, com o banco de mentira que GRAVA o que a rota escreve:
 *   (1) na loja, ninguém da equipe passa por pedido: agendou, está marcado (mesmo sem vendedor_id no corpo);
 *   (2) agendar no lead de OUTRA pessoa passa, e o DONO NÃO MUDA (nenhum update de owner no crm_leads); o dono é
 *       avisado; o lead SEM dono vai para quem agenda e o guardião vem do rodízio (0628);
 *   (4) a clínica segue pedindo.
 */
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const EU = "22222222-2222-4222-8222-222222222222"; // o vendedor que agenda
const DONO = "33333333-3333-4333-8333-333333333333"; // o dono do lead (outra pessoa)
const LEAD = "44444444-4444-4444-8444-444444444444";
const CONTATO = "55555555-5555-4555-8555-555555555555";
const TIPO = "66666666-6666-4666-8666-666666666666";

interface Gravado {
  tabela: string;
  op: "update" | "insert";
  valores: Record<string, unknown>;
}

let gravados: Gravado[];
let rpcs: Array<{ nome: string; args: Record<string, unknown> }>;
let leadDaSessao: Record<string, unknown> | null;
let marcaDireto: boolean;
let avisosAoDono: unknown[];
let avisosAoVendedor: unknown[];
let compromissos: Array<Record<string, unknown>>;
let pedidosGravados: number;

/** Um banco de mentira: toda cadeia aceita qualquer filtro e GRAVA updates/inserts. */
function banco(dados: (tabela: string) => unknown) {
  return {
    from(tabela: string) {
      let op: Gravado | null = null;
      const q: Record<string, unknown> = {};
      const encadeia = () => q;
      for (const m of ["select", "eq", "is", "not", "order", "limit", "in", "or", "gte"]) q[m] = encadeia;
      q.update = (valores: Record<string, unknown>) => {
        op = { tabela, op: "update", valores };
        gravados.push(op);
        return q;
      };
      q.insert = (valores: Record<string, unknown>) => {
        op = { tabela, op: "insert", valores };
        gravados.push(op);
        return q;
      };
      q.maybeSingle = async () => ({ data: op ? { id: LEAD, ...op.valores } : dados(tabela), error: null });
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
      return q;
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return { data: null, error: null };
    },
  };
}

function montarMocks() {
  vi.resetModules();
  vi.doMock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
  vi.doMock("@/lib/auth/require-role", () => ({
    requireRole: async () => ({ ok: true, org: { orgId: ORG, role: "agent" }, user: { id: EU, idioma: "pt-BR" } }),
  }));
  vi.doMock("@/lib/iavek/sdr-marca-direto", () => ({
    marcaDiretoNaLoja: async () => ({ marcaDireto, ehSdr: false }),
    vendedoresDaLoja: async () => [
      { id: EU, nome: "Eu" },
      { id: DONO, nome: "Dono" },
    ],
  }));
  vi.doMock("@/lib/iavek/perfil-da-empresa-servidor", () => ({ modoAgendamentoDaOrg: async () => !marcaDireto }));
  vi.doMock("@/lib/supabase/admin", () => ({
    createAdminClient: () =>
      banco((t) => (t === "contacts" ? { name: "Cliente", display_name: null, phone_number: null } : t === "crm_leads" ? { owner_user_id: DONO, id: LEAD } : null)),
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => banco((t) => (t === "crm_leads" ? leadDaSessao : null)),
  }));
  vi.doMock("@/lib/iavek/pedidos-de-agendamento", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    gravarPedidoDeAgendamento: async () => {
      pedidosGravados += 1;
      return { ok: true, pedido: { id: "pedido-1", quando: "2030-01-01T13:00:00.000Z", contact_id: CONTATO, lead_id: LEAD, conversation_id: null, observacao: null, titulo: null } };
    },
  }));
  vi.doMock("@/app/api/v1/agenda/agendamentos/_handler", () => ({
    marcarAgendamentoHandler: async (_db: unknown, ctx: Record<string, unknown>, input: Record<string, unknown>) => {
      compromissos.push({ ...input, ctx });
      return { id: "compromisso-1", title: "Visita na loja", status: "confirmed" };
    },
  }));
  vi.doMock("@/lib/iavek/passagem-servidor", () => ({
    anotarCampos: async () => null,
    lerLeadDaPassagem: async () => ({ id: LEAD, organization_id: ORG, contact_id: CONTATO, pipeline_id: "p", stage_id: "s" }),
    moverParaAEtapaDaPassagem: async () => true,
    passarAConversa: async () => {
      gravados.push({ tabela: "conversa", op: "update", valores: { passou: true } });
    },
    registrarPassagem: async () => {
      gravados.push({ tabela: "passagem", op: "insert", valores: {} });
    },
  }));
  vi.doMock("@/lib/iavek/avisos-da-proposta", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    avisarDonoDoAgendamento: async (_db: unknown, a: unknown) => {
      avisosAoDono.push(a);
    },
    avisarVendedorDoAgendamento: async (_db: unknown, a: unknown) => {
      avisosAoVendedor.push(a);
    },
  }));
  vi.doMock("@/lib/audit", () => ({ audit: async () => undefined }));
}

async function agendar(corpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/iavek/pedidos-de-agendamento/route");
  return POST(
    new NextRequest("http://x/api/v1/iavek/pedidos-de-agendamento", {
      method: "POST",
      body: JSON.stringify({ contact_id: CONTATO, lead_id: LEAD, quando: "2030-01-01T13:00:00.000Z", event_type_id: TIPO, ...corpo }),
    }),
  );
}

const donoMexido = () =>
  gravados.filter((g) => g.tabela === "crm_leads" && g.op === "update" && "owner_user_id" in g.valores);

beforeEach(() => {
  gravados = [];
  rpcs = [];
  avisosAoDono = [];
  avisosAoVendedor = [];
  compromissos = [];
  pedidosGravados = 0;
  marcaDireto = true;
  montarMocks();
});

describe("(2) agendar no lead de OUTRA pessoa: passa, e o DONO NÃO MUDA", () => {
  it("201, o compromisso nasce MARCADO, nenhum update de dono, a conversa não muda de mãos, sem 'passagem'", async () => {
    leadDaSessao = { id: LEAD, custom_fields: {}, owner_user_id: DONO, sdr_user_id: null };
    const res = await agendar({ vendedor_id: EU });
    expect(res.status).toBe(201);
    expect(compromissos).toHaveLength(1);
    expect((compromissos[0]!.ctx as { iavekSdrMarcaParaVendedor?: boolean }).iavekSdrMarcaParaVendedor).toBe(true); // = confirmado
    expect(donoMexido()).toEqual([]);
    expect(gravados.some((g) => g.tabela === "conversa")).toBe(false);
    expect(gravados.some((g) => g.tabela === "passagem")).toBe(false);
    expect(rpcs).toEqual([]); // tem dono: o rodízio não entra
  });

  it("o DONO é avisado (quem agendou é o ator), e não recebe aviso em dobro como 'vendedor'", async () => {
    leadDaSessao = { id: LEAD, custom_fields: {}, owner_user_id: DONO, sdr_user_id: null };
    await agendar({ vendedor_id: DONO });
    expect(avisosAoDono).toEqual([expect.objectContaining({ donoId: DONO, atorId: EU, leadId: LEAD, titulo: "Visita na loja" })]);
    expect(avisosAoVendedor).toEqual([]);
    expect(donoMexido()).toEqual([]);
  });

  it("antes era 403 ('peça à gerência'): a trava não existe mais", async () => {
    leadDaSessao = { id: LEAD, custom_fields: {}, owner_user_id: DONO, sdr_user_id: "outra-sdr" };
    const res = await agendar({ vendedor_id: EU });
    expect(res.status).toBe(201);
    expect(donoMexido()).toEqual([]);
  });
});

describe("(2) o lead SEM dono: quem agenda fica dono, e o guardião vem do rodízio (0628)", () => {
  it("o dono vira quem agendou e a função do rodízio é chamada para o lead", async () => {
    leadDaSessao = { id: LEAD, custom_fields: {}, owner_user_id: null, sdr_user_id: null };
    const res = await agendar({ vendedor_id: EU });
    expect(res.status).toBe(201);
    expect(donoMexido().map((g) => g.valores.owner_user_id)).toContain(EU);
    expect(rpcs).toEqual([{ nome: "fn_iavek_guardiao_do_agendamento", args: { p_org: ORG, p_lead: LEAD, p_ator: EU } }]);
    expect(avisosAoDono).toEqual([]); // não havia dono para avisar
  });
});

describe("(1) na loja, ninguém da equipe fica com pedido pendente", () => {
  it("sem vendedor_id (a tela que caiu no 'Pedir'), o vendedor MARCA para ele mesmo: nada de pedido pendente para um admin", async () => {
    leadDaSessao = { id: LEAD, custom_fields: {}, owner_user_id: EU, sdr_user_id: null };
    const res = await agendar({});
    expect(res.status).toBe(201);
    expect(compromissos).toHaveLength(1);
    expect(compromissos[0]!.owner_user_id).toBe(EU);
    // o pedido grava só o histórico, já CONFIRMADO no mesmo passo
    expect(gravados.some((g) => g.tabela === "iavek_pedidos_de_agendamento" && g.valores.status === "confirmado")).toBe(true);
  });
});

describe("(4) a clínica fica como está: segue pedindo", () => {
  it("fora da loja, sem vendedor_id, nasce o PEDIDO (nenhum compromisso)", async () => {
    marcaDireto = false;
    montarMocks();
    leadDaSessao = null;
    const res = await agendar({});
    expect(res.status).toBe(201);
    expect(compromissos).toEqual([]);
    expect(pedidosGravados).toBe(1);
  });

  it("fora da loja, com vendedor_id: 403 (a clínica decide pelo admin)", async () => {
    marcaDireto = false;
    montarMocks();
    const res = await agendar({ vendedor_id: EU });
    expect(res.status).toBe(403);
    expect(compromissos).toEqual([]);
  });
});

describe("(1)(2) as peças em volta: o compromisso nasce marcado, o sino do dono, o histórico de quem marcou", () => {
  const ler = (f: string) => readFileSync(f, "utf8");

  it("(1) na loja, a pessoa que agenda pela Agenda também já deixa MARCADO, qualquer que seja o tipo", () => {
    const h = ler("app/api/v1/agenda/agendamentos/_handler.ts");
    expect(h).toContain('ctx.iavekAgendaLivre && ctx.actor.type === "user"\n        ? "confirmed"');
    expect(ler("app/api/v1/agenda/agendamentos/route.ts")).toContain("iavekAgendaLivre: !modoAgendamento,");
  });

  it("(2) o sino tem o aviso do dono (0629 + baseline num bloco só + a frase na tela)", () => {
    expect(ler("supabase/migrations/20261112041000_0629_iavek_aviso_agendamento_no_seu_lead.sql")).toContain("'agendamento_no_seu_lead'");
    const b = ler("supabase/baseline.sql");
    const ultima = b.slice(b.lastIndexOf("add constraint notificacoes_tipo_check"));
    expect(ultima.slice(0, ultima.indexOf("));"))).toContain("'agendamento_no_seu_lead'");
    const sino = ler("components/shell/SinoPessoal.tsx");
    expect(sino).toContain('case "agendamento_no_seu_lead":');
    expect(sino).toContain('troca("{who} agendou {what} no seu lead {lead}, para {when}")');
  });

  it("(2) o histórico registra QUEM marcou: o compromisso guarda o autor e a linha do tempo do lead leva o ator", () => {
    const h = ler("app/api/v1/agenda/agendamentos/_handler.ts");
    expect(h).toContain('created_by_user_id: ctx.actor.type === "user" ? ctx.actor.id : null,');
    expect(h).toMatch(/await emitLeadActivity\(supabase, \{[\s\S]{0,300}actor: ctx\.actor,/);
    // e a rota marca com o AUTOR de verdade (quem agendou), não com o dono
    expect(ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts")).toContain(
      'actor: { type: "user", id: authz.user.id, role: authz.org.role },',
    );
  });
});
