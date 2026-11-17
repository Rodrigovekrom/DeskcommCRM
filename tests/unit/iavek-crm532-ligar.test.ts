/**
 * ia.vek CRM-532 — o botão "Ligar" e o "Como foi a ligação?" (aprovado pelo Rodrigo, opção a; desenho OK do Maestro
 * 194333).
 *
 * O que estes testes travam:
 *   - o `href` é `tel:+<dígitos>` do telefone do CADASTRO; sem número utilizável, sem botão;
 *   - a volta só conta depois de 5 s fora e enquanto a marca vale (2 h);
 *   - a rota da TAREFA segue fazendo o mesmo de antes (fecha a tarefa, call_logged, efeitos), agora pelo registrar
 *     compartilhado;
 *   - a rota do CONTATO: com tarefa de ligação aberta, fecha ESSA tarefa; sem tarefa, só a linha do tempo (origem
 *     'ligar') e o próximo passo; sem negócio aberto, recusa; quem não vê o contato, 404;
 *   - a decisão pendente do Rodrigo mora num ponto só (LIGACAO_SEM_TAREFA_REGISTRA).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MINIMO_FORA_MS, VALIDADE_DA_MARCA_MS, funcoesQueLigam, hrefDeLigar, ligaNaTela, ligaPeloCrm } from "@/lib/ligar/regras";
import { voltouDaLigacao } from "@/lib/ligar/marca";

describe("CRM-532: o href do botão Ligar", () => {
  it("o telefone canônico do cadastro vira tel:+<dígitos>", () => {
    expect(hrefDeLigar("+5532984793302")).toBe("tel:+5532984793302");
    expect(hrefDeLigar("+55 (32) 98479-3302")).toBe("tel:+5532984793302");
  });
  it("(Lupa 205419) só com o código do país: o local sem o país não vira link (seria outro país)", () => {
    expect(hrefDeLigar("5532984793302")).toBe("tel:+5532984793302");
    expect(hrefDeLigar("+1 212 555 0100")).toBe("tel:+12125550100");
    expect(hrefDeLigar("32984793302")).toBeNull();
    expect(hrefDeLigar("(32) 98479-3302")).toBeNull();
  });

  it("sem número utilizável, sem botão", () => {
    expect(hrefDeLigar(null)).toBeNull();
    expect(hrefDeLigar("")).toBeNull();
    expect(hrefDeLigar("123")).toBeNull();
    expect(hrefDeLigar("1".repeat(16))).toBeNull();
  });
});

describe("CRM-532: quem liga pelo CRM (Rodrigo 17/11: 'todo mundo que quiser'; a loja pode restringir)", () => {
  it("de fábrica, TODO MUNDO QUE ATENDE, com qualquer função ou sem função; o viewer (não atende) nunca; o analista de ficha nunca", () => {
    for (const f of ["vendedor", "sdr", "sdr_followup", "gerente", "apoio", "suporte", undefined, null, ""]) {
      expect(ligaPeloCrm(f, {}, true)).toBe(true);
    }
    expect(ligaPeloCrm("vendedor", {}, false)).toBe(false); // o viewer: não atende
    expect(ligaPeloCrm(undefined, {}, false)).toBe(false);
    expect(ligaPeloCrm("analista_ficha", {}, true)).toBe(false);
  });
  it("a loja que restringe a ['vendedor']: só o vendedor; quem não tem função fica fora", () => {
    const loja = { iavek: { ligar: { funcoes: ["vendedor"] } } };
    expect(ligaPeloCrm("vendedor", loja, true)).toBe(true);
    for (const f of ["sdr", "sdr_followup", "gerente", "suporte", undefined]) expect(ligaPeloCrm(f, loja, true)).toBe(false);
  });
  it("(Lupa 213638) em prévia 'ver como', pela PRESENÇA da prévia: sem botão, mesmo com a função igual à real", () => {
    expect(ligaNaTela(true, false)).toBe(true); // sem prévia: vale o do servidor
    expect(ligaNaTela(true, true)).toBe(false); // em prévia (qualquer função, inclusive a igual à real)
    expect(ligaNaTela(false, false)).toBe(false); // o servidor disse não (ex.: o viewer)
  });

  it("valor ruim na config volta ao padrão (todo mundo que atende), e o viewer continua fora", () => {
    for (const ruim of ["vendedor", 3, null, [], ["nao_existe"], [1, 2]]) {
      expect(funcoesQueLigam({ iavek: { ligar: { funcoes: ruim } } })).toBeNull();
      expect(ligaPeloCrm("sdr", { iavek: { ligar: { funcoes: ruim } } }, true)).toBe(true);
      expect(ligaPeloCrm("sdr", { iavek: { ligar: { funcoes: ruim } } }, false)).toBe(false);
    }
  });
});

describe("CRM-532: a volta do discador", () => {
  const m = { contatoId: "c", leadId: null, tarefaId: null, em: 1_000_000 };
  it("só conta depois de 5 s fora", () => {
    expect(voltouDaLigacao(m, m.em + MINIMO_FORA_MS - 1)).toBe(false);
    expect(voltouDaLigacao(m, m.em + MINIMO_FORA_MS)).toBe(true);
  });
  it("a marca vence em 2 h; sem marca, nada", () => {
    expect(voltouDaLigacao(m, m.em + VALIDADE_DA_MARCA_MS)).toBe(true);
    expect(voltouDaLigacao(m, m.em + VALIDADE_DA_MARCA_MS + 1)).toBe(false);
    expect(voltouDaLigacao(null, m.em + 10_000)).toBe(false);
  });
});

describe("CRM-532: a decisão pendente do Rodrigo mora num ponto só", () => {
  it("só lib/ligar/regras.ts define LIGACAO_SEM_TAREFA_REGISTRA; a rota e a tela importam de lá", () => {
    const regras = readFileSync(join(process.cwd(), "lib/ligar/regras.ts"), "utf8");
    expect(regras).toMatch(/export const LIGACAO_SEM_TAREFA_REGISTRA = (true|false);/);
    const rota = readFileSync(join(process.cwd(), "app/api/v1/contacts/[id]/ligacao/route.ts"), "utf8");
    expect(rota).toContain('from "@/lib/ligar/regras"');
    expect(rota).not.toMatch(/const LIGACAO_SEM_TAREFA_REGISTRA/);
  });
});

// ─── as rotas, com um banco falso ───────────────────────────────────────────────────────────────────────────────────

type Linhas = Record<string, unknown>;
interface Banco {
  /** o vínculo de QUEM chama (a função decide se liga pelo CRM) */
  user_organizations: Linhas[];
  /** a org (a config da loja: settings.iavek.ligar.funcoes) */
  organizations?: Linhas[];
  contacts: Linhas[];
  crm_leads: Linhas[];
  crm_tasks: Linhas[];
  /** quantas linhas o update de crm_tasks (fechar) devolve */
  fecha: number;
  /** quantas linhas o DESFAZER do fechamento (update status de volta, filtrado por status='done') devolve */
  desfaz: number;
  /** as ligações abertas que o 'cancelar_ligacoes_pendentes' (status cancelled) devolve */
  cancela: Linhas[];
}

function clienteFalso(b: Banco) {
  const updates: { tabela: string; valores: unknown; filtros: [string, unknown][] }[] = [];
  const from = (tabela: string) => {
    const filtros: [string, unknown][] = [];
    let valores: unknown = undefined;
    const filtrar = () => {
      const fonte = ((b as unknown as Record<string, Linhas[]>)[tabela] ?? []) as Linhas[];
      return fonte.filter((l) =>
        filtros.every(([col, v]) => {
          if (col.startsWith("in:")) return (v as unknown[]).includes(l[col.slice(3)]);
          if (col.startsWith("like:")) return String(l[col.slice(5)] ?? "").startsWith(String(v).replace(/%$/, ""));
          return l[col] === undefined || l[col] === v;
        }),
      );
    };
    const resultado = () => {
      if (valores !== undefined) {
        updates.push({ tabela, valores, filtros: [...filtros] });
        if (tabela === "crm_tasks" && (valores as { status?: string }).status === "done") {
          return { data: Array.from({ length: b.fecha }, () => ({ id: "t" })), error: null };
        }
        if (tabela === "crm_tasks" && (valores as { status?: string }).status === "cancelled") {
          return { data: b.cancela, error: null };
        }
        if (tabela === "crm_tasks" && filtros.some(([c, v]) => c === "status" && v === "done")) {
          return { data: Array.from({ length: b.desfaz }, () => ({ id: "t" })), error: null };
        }
        return { data: [], error: null };
      }
      if (tabela === "organizations") return { data: b.organizations ?? [{ settings: {} }], error: null };
      if (tabela === "crm_pipelines") return { data: [], error: null };
      return { data: filtrar(), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      update: (v: unknown) => {
        valores = v;
        return q;
      },
      eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
      in: (c: string, v: unknown) => (filtros.push([`in:${c}`, v]), q),
      like: (c: string, v: unknown) => (filtros.push([`like:${c}`, v]), q),
      is: (_c: string, _v: unknown) => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        const r = resultado();
        return { data: (r.data as unknown[])[0] ?? null, error: null };
      },
      then: (ok: (r: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, err),
    };
    return q;
  };
  return { cliente: { from }, updates };
}

const ORG = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const TAREFA = "44444444-4444-4444-8444-444444444444";

const espioes = vi.hoisted(() => ({
  emitLeadActivity: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  registraAtividadeDaTarefa: vi.fn(async () => undefined),
  criarTarefaInterna: vi.fn(async () => ({ ok: true })),
  moveLeadHandler: vi.fn(async () => undefined),
  encerraDemanda: vi.fn(async () => undefined),
  cliente: { atual: null as unknown },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => espioes.cliente.atual }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: ORG }, user: { id: "u-quem-ligou", idioma: "pt-BR" } }),
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: async () => undefined }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: espioes.emitLeadActivity }));
vi.mock("@/lib/tarefas/atividade", () => ({ registraAtividadeDaTarefa: espioes.registraAtividadeDaTarefa }));
vi.mock("@/lib/tarefas/criar-tarefa", () => ({ criarTarefaInterna: espioes.criarTarefaInterna }));
vi.mock("@/app/api/v1/leads/_handler", () => ({ moveLeadHandler: espioes.moveLeadHandler }));
vi.mock("@/lib/leads/encerramento", () => ({ encerraDemanda: espioes.encerraDemanda }));

function banco(over: Partial<Banco> = {}): Banco {
  return {
    user_organizations: [{ organization_id: ORG, user_id: "u-quem-ligou", interface_settings: { preset: "completa", funcao: "vendedor" } }],
    contacts: [{ id: CONTATO, organization_id: ORG }],
    crm_leads: [
      { id: LEAD, organization_id: ORG, pipeline_id: "p1", status: "open", contact_id: CONTATO, last_activity_at: null, created_at: "2026-11-01T00:00:00Z" },
    ],
    crm_tasks: [],
    fecha: 1,
    desfaz: 1,
    cancela: [],
    ...over,
  };
}
const tarefaDeLigacao = (status = "pending") => ({
  id: TAREFA, organization_id: ORG, title: "Ligar (L1) — Maria", description: null, due_date: "2026-11-17T12:00:00Z",
  priority: "high", status, lead_id: LEAD, contact_id: CONTATO, assigned_to: "u-dona", created_by: null,
  created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", source_kind: "ligacao:L1",
});
const pedido = (url: string, corpo?: unknown) =>
  new Request(url, corpo === undefined ? undefined : { method: "POST", body: JSON.stringify(corpo), headers: { "content-type": "application/json" } }) as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  espioes.emitLeadActivity.mockImplementation(async () => ({ ok: true }));
  for (const f of [espioes.emitLeadActivity, espioes.registraAtividadeDaTarefa, espioes.criarTarefaInterna, espioes.moveLeadHandler, espioes.encerraDemanda]) f.mockClear();
});

describe("CRM-532: a rota da TAREFA segue igual (agora pelo registrar compartilhado)", () => {
  it("fecha a tarefa, grava o call_logged de origem 'esteira' e, sem atender, cria a retentativa", async () => {
    const f = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao()] }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/tasks/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/tasks/${TAREFA}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(TAREFA));
    expect(r.status).toBe(201);
    expect(f.updates.some((u) => u.tabela === "crm_tasks" && (u.valores as { status: string }).status === "done")).toBe(true);
    expect(espioes.registraAtividadeDaTarefa).toHaveBeenCalledTimes(1);
    expect(espioes.emitLeadActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "call_logged", sourceModule: "esteira", sourceId: TAREFA }));
    expect(espioes.criarTarefaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sourceKind: "ligacao:retentativa", atribuirA: { usuario_id: "u-dona" } }));
  });

  it("(Lupa 200426) a tarefa que a sessão NÃO vê: 404, nada gravado", async () => {
    const f = clienteFalso(banco({ crm_tasks: [] }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/tasks/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/tasks/${TAREFA}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(TAREFA));
    expect(r.status).toBe(404);
    expect(f.updates).toEqual([]);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
  });

  it("(Lupa 200426) a tarefa ABERTA cujo fechamento volta com 0 linhas (a RLS barrando): 403, e NADA mais gravado", async () => {
    const f = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao()], fecha: 0 }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/tasks/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/tasks/${TAREFA}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(TAREFA));
    expect(r.status).toBe(403);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
    expect(espioes.registraAtividadeDaTarefa).not.toHaveBeenCalled();
    expect(espioes.criarTarefaInterna).not.toHaveBeenCalled();
  });

  it("(Lupa 200426) a linha do tempo que FALHA: desfaz o fechamento da tarefa, erro 500, sem o próximo passo", async () => {
    espioes.emitLeadActivity.mockImplementation(async () => ({ ok: false, error: "permission denied" }));
    const { logger } = await import("@/lib/logger");
    const erro = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const f = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao("in_progress")] }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/tasks/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/tasks/${TAREFA}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(TAREFA));
    expect(r.status).toBe(500);
    expect(erro).toHaveBeenCalledWith("[ligacao] call_logged não gravou; tarefa desfeita", expect.anything());
    expect(erro).not.toHaveBeenCalledWith("[ligacao] desfazer falhou", expect.anything());
    const desfez = f.updates.find((u) => u.tabela === "crm_tasks" && (u.valores as { status: string }).status === "in_progress");
    expect(desfez?.filtros).toContainEqual(["id", TAREFA]);
    expect(desfez?.filtros).toContainEqual(["status", "done"]);
    expect(espioes.registraAtividadeDaTarefa).not.toHaveBeenCalled();
    expect(espioes.criarTarefaInterna).not.toHaveBeenCalled();
    erro.mockRestore();
  });

  it("(Lupa 200617) o DESFAZER que também falha (0 linhas): vai ao log '[ligacao] desfazer falhou' com o id da tarefa, e 500", async () => {
    espioes.emitLeadActivity.mockImplementation(async () => ({ ok: false, error: "permission denied" }));
    const { logger } = await import("@/lib/logger");
    const erro = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const f = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao("pending")], desfaz: 0 }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/tasks/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/tasks/${TAREFA}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(TAREFA));
    expect(r.status).toBe(500);
    expect(erro).toHaveBeenCalledWith("[ligacao] desfazer falhou", expect.objectContaining({ task_id: TAREFA }));
    erro.mockRestore();
  });

  it("(Lupa 200426) sem tarefa, a linha do tempo que FALHA: erro 500, nunca 'registrei'", async () => {
    espioes.emitLeadActivity.mockImplementation(async () => ({ ok: false, error: "x" }));
    espioes.cliente.atual = clienteFalso(banco()).cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(r.status).toBe(500);
    expect(espioes.criarTarefaInterna).not.toHaveBeenCalled();
  });

  it("dois cliques: a tarefa que a sessão já vê FECHADA é 409 'já registrada' e não grava a linha do tempo", async () => {
    const f = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao("done")] }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/tasks/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/tasks/${TAREFA}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(TAREFA));
    expect(r.status).toBe(409);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
  });
});

describe("CRM-532: a rota do CONTATO (o 'Como foi a ligação?')", () => {
  it("GET: com tarefa de ligação aberta, pergunta e diz qual tarefa", async () => {
    espioes.cliente.atual = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao()] })).cliente;
    const { GET } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await GET({ nextUrl: new URL(`http://x/api/v1/contacts/${CONTATO}/ligacao`) } as never, ctx(CONTATO));
    const j = (await r.json()) as { data: { pergunta: boolean; lead_id: string; tarefa: { id: string } | null } };
    expect(j.data).toMatchObject({ pergunta: true, lead_id: LEAD, tarefa: { id: TAREFA } });
  });

  it("GET: sem negócio aberto, NÃO pergunta (não há onde registrar)", async () => {
    espioes.cliente.atual = clienteFalso(banco({ crm_leads: [] })).cliente;
    const { GET } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await GET({ nextUrl: new URL(`http://x/api/v1/contacts/${CONTATO}/ligacao`) } as never, ctx(CONTATO));
    const j = (await r.json()) as { data: { pergunta: boolean } };
    expect(j.data.pergunta).toBe(false);
  });

  it("GET/POST: quem não vê o contato (a RLS não devolve) recebe 404", async () => {
    espioes.cliente.atual = clienteFalso(banco({ contacts: [] })).cliente;
    const { GET, POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const g = await GET({ nextUrl: new URL(`http://x/api/v1/contacts/${CONTATO}/ligacao`) } as never, ctx(CONTATO));
    expect(g.status).toBe(404);
    const p = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(p.status).toBe(404);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
  });

  it("POST com tarefa de ligação aberta: fecha ESSA tarefa (o mesmo caminho da tela de Tarefas)", async () => {
    const f = clienteFalso(banco({ crm_tasks: [tarefaDeLigacao()] }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(r.status).toBe(201);
    const fechou = f.updates.find((u) => u.tabela === "crm_tasks" && (u.valores as { status: string }).status === "done");
    expect(fechou?.filtros).toContainEqual(["id", TAREFA]);
    expect(espioes.emitLeadActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ leadId: LEAD, sourceModule: "esteira", sourceId: TAREFA }));
  });

  it("POST SEM tarefa: nada a fechar; o call_logged de origem 'ligar' no negócio; a retentativa fica com QUEM ligou", async () => {
    const f = clienteFalso(banco());
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(r.status).toBe(201);
    expect(f.updates.some((u) => u.tabela === "crm_tasks" && (u.valores as { status: string }).status === "done")).toBe(false);
    expect(espioes.registraAtividadeDaTarefa).not.toHaveBeenCalled();
    expect(espioes.emitLeadActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "call_logged", leadId: LEAD, sourceModule: "ligar", payload: expect.objectContaining({ task_id: null, codigo: "avulsa" }) }),
    );
    expect(espioes.criarTarefaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ atribuirA: { usuario_id: "u-quem-ligou" } }));
  });

  it("POST com o lead_id da tela (o painel do negócio): registra NAQUELE negócio, se for do contato e estiver aberto", async () => {
    const OUTRO = "55555555-5555-4555-8555-555555555555";
    const f = clienteFalso(
      banco({
        crm_leads: [
          { id: LEAD, organization_id: ORG, pipeline_id: "p1", status: "open", contact_id: CONTATO, last_activity_at: "2026-11-17T00:00:00Z", created_at: "2026-11-01T00:00:00Z" },
          { id: OUTRO, organization_id: ORG, pipeline_id: "p2", status: "open", contact_id: CONTATO, last_activity_at: null, created_at: "2026-11-02T00:00:00Z" },
        ],
      }),
    );
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal", lead_id: OUTRO }), ctx(CONTATO));
    expect(r.status).toBe(201);
    expect(espioes.emitLeadActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ leadId: OUTRO }));
  });

  it("(Lupa 194615) o vendedor de FORA, que não vê o negócio pedido (a RLS não o devolve): 404 e nada gravado", async () => {
    const INVISIVEL = "66666666-6666-4666-8666-666666666666";
    const f = clienteFalso(banco()); // a RLS devolve só o LEAD; o INVISIVEL não vem
    espioes.cliente.atual = f.cliente;
    const { GET, POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const g = await GET({ nextUrl: new URL(`http://x/api/v1/contacts/${CONTATO}/ligacao?lead_id=${INVISIVEL}`) } as never, ctx(CONTATO));
    expect(g.status).toBe(404);
    const p = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal", lead_id: INVISIVEL }), ctx(CONTATO));
    expect(p.status).toBe(404);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
    expect(espioes.criarTarefaInterna).not.toHaveBeenCalled();
    expect(f.updates).toEqual([]);
  });

  it("a rota nova nunca usa o cliente ADMIN (a RLS da sessão decide)", () => {
    const rota = readFileSync(join(process.cwd(), "app/api/v1/contacts/[id]/ligacao/route.ts"), "utf8");
    const reg = readFileSync(join(process.cwd(), "app/api/v1/_ligacao/registrar.ts"), "utf8");
    for (const f of [rota, reg]) {
      expect(f).not.toMatch(/createAdminClient|supabase\/admin|service_role/);
    }
  });

  it("(Lupa 205419) 'agendou' cancela as ligações abertas COM o motivo e 1 linha task_cancelled por tarefa", async () => {
    const aberta = { id: "77777777-7777-4777-8777-777777777777", contact_id: CONTATO, title: "Ligar (L2) — Maria", source_kind: "ligacao:L2" };
    const f = clienteFalso(banco({ cancela: [aberta] }));
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(
      pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: true, resumo: "vem sábado ver o carro", proximo: { tipo: "agendou", data: "2026-11-21T13:00:00.000Z" } }),
      ctx(CONTATO),
    );
    expect(r.status).toBe(201);
    const cancelou = f.updates.find((u) => u.tabela === "crm_tasks" && (u.valores as { status: string }).status === "cancelled");
    expect(cancelou?.valores).toEqual({ status: "cancelled", cancelada_motivo: "ligacao_registrada" });
    expect(espioes.emitLeadActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "task_cancelled", sourceModule: "tarefas", sourceId: aberta.id, payload: expect.objectContaining({ motivo: "ligacao_registrada", origem: "ligacao" }) }),
    );
  });

  it("a loja que RESTRINGE a ['vendedor']: a SDR não pergunta no GET e leva 403 no POST, sem gravar nada", async () => {
    const f = clienteFalso(
      banco({
        user_organizations: [{ organization_id: ORG, user_id: "u-quem-ligou", interface_settings: { preset: "completa", funcao: "sdr" } }],
        organizations: [{ id: ORG, settings: { iavek: { ligar: { funcoes: ["vendedor"] } } } }],
        crm_tasks: [tarefaDeLigacao()],
      }),
    );
    espioes.cliente.atual = f.cliente;
    const { GET, POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const g = await GET({ nextUrl: new URL(`http://x/api/v1/contacts/${CONTATO}/ligacao`) } as never, ctx(CONTATO));
    expect(((await g.json()) as { data: { pergunta: boolean } }).data.pergunta).toBe(false);
    const p = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(p.status).toBe(403);
    expect(f.updates).toEqual([]);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
  });

  it("(Lupa 212827) a SDR (de fábrica, liga) liga para o cliente do negócio do VENDEDOR: grava NAQUELE negócio, a próxima fica com ELA e o dono não muda", async () => {
    const f = clienteFalso(
      banco({
        user_organizations: [{ organization_id: ORG, user_id: "u-quem-ligou", interface_settings: { preset: "completa", funcao: "sdr" } }],
      }),
    );
    espioes.cliente.atual = f.cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(r.status).toBe(201);
    expect(espioes.emitLeadActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "call_logged", leadId: LEAD }));
    expect(espioes.criarTarefaInterna).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ atribuirA: { usuario_id: "u-quem-ligou" } }));
    expect(f.updates.some((u) => u.tabela === "crm_leads")).toBe(false); // o dono do negócio não muda
  });

  it("POST sem negócio aberto: 422, nada gravado", async () => {
    espioes.cliente.atual = clienteFalso(banco({ crm_leads: [] })).cliente;
    const { POST } = await import("@/app/api/v1/contacts/[id]/ligacao/route");
    const r = await POST(pedido(`http://x/api/v1/contacts/${CONTATO}/ligacao`, { atendeu: false, resumo: "caixa postal" }), ctx(CONTATO));
    expect(r.status).toBe(422);
    expect(espioes.emitLeadActivity).not.toHaveBeenCalled();
  });
});

describe("CRM-532: o botão nas telas (a fiação)", () => {
  const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("está na conversa (fora de grupo), no contato, no painel do negócio e na tarefa de ligação aberta", () => {
    expect(ler("components/inbox/ConversationHeader.tsx")).toMatch(/!conversation\.is_group && c\?\.id && \(\s*<BotaoLigar/);
    expect(ler("app/app/contacts/[id]/_client.tsx")).toContain("<BotaoLigar contatoId={contactId}");
    expect(ler("components/kanban/LeadDossier.tsx")).toContain("leadId={lead.id} />");
    expect(ler("app/app/tasks/_components/ListaDeTarefas.tsx")).toMatch(/!encerrada && ehLigacao\(tarefa\.source_kind\)/);
  });
  it("o 'Como foi a ligação?' é montado uma vez, na casca, só para quem liga pelo CRM (e a marca antiga dos outros some)", () => {
    expect(ler("app/app/_components/AppShell.tsx")).toContain("{ligaAqui ? <ComoFoiALigacao /> : <ApagaMarcaAntiga />}");
    expect(ler("app/app/_components/AppShell.tsx")).toContain("ligaNaTela(ligaPeloCrm, useEmPreviaOpcional())");
    expect(ler("app/app/layout.tsx")).toContain("ligaPeloCrm={ligaPeloCrmAqui}");
  });
});
