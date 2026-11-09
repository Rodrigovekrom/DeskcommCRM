/**
 * ia.vek v1.9.37 (CRM-260 e CRM-229) — listas grandes em lotes, e o carro do anúncio no clone da esteira.
 *
 * TESTE-GUARDA: o banco falso abaixo faz o que o Node faz de verdade quando um `.in()` leva mais de 100
 * ids — devolve `UND_ERR_HEADERS_OVERFLOW` (medido em 07/11 dentro da imagem de produção: 300 ids
 * passam, 400 falham sempre, porque o PostgREST repete a URL no cabeçalho `Content-Location` e o Node
 * corta em 16 KB). E anota o maior `.in()` que viu. Com a Fenômenos em escala (500 leads no radar, 838
 * no risk-watcher, ~350 no Space do Guardião), nenhum caminho pode mandar um `.in()` acima de 100.
 * Antes da v1.9.37 os três mandavam a lista inteira: o radar saía sem nome e sem link da conversa, o
 * risk-watcher perdia o "em voo" e a tela da guardiã caía.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IDS_POR_LOTE } from "@/lib/supabase/em-lotes";

// ---------------------------------------------------------------- o banco falso
type Linha = Record<string, unknown>;
interface Sonda {
  maiorIn: number;
  estouros: string[];
}
function bancoFalso(tabelas: Record<string, Linha[]>, sonda: Sonda) {
  return {
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let de = 0;
      let ate = Number.POSITIVE_INFINITY;
      let unico = false;
      let estourou = false;
      const q: Record<string, unknown> = {};
      const mesmo = () => q;
      for (const m of ["select", "order", "limit", "not", "neq", "gt", "gte", "lt", "lte", "is", "update", "or"]) q[m] = mesmo;
      q.eq = (col: string, v: unknown) => {
        filtros.push((l) => !(col in l) || l[col] === v);
        return q;
      };
      q.in = (col: string, vs: unknown[]) => {
        sonda.maiorIn = Math.max(sonda.maiorIn, vs.length);
        if (vs.length > IDS_POR_LOTE) {
          estourou = true;
          sonda.estouros.push(`${tabela}.${col} com ${vs.length} ids`);
        }
        const conj = new Set(vs);
        filtros.push((l) => !(col in l) || conj.has(l[col]));
        return q;
      };
      q.range = (a: number, b: number) => {
        de = a;
        ate = b;
        return q;
      };
      q.maybeSingle = () => {
        unico = true;
        return q;
      };
      q.single = q.maybeSingle;
      q.then = (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (estourou) {
          return Promise.resolve({ data: null, error: { message: "TypeError: fetch failed (UND_ERR_HEADERS_OVERFLOW)" } }).then(ok, ko);
        }
        const linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
        const data = unico ? (linhas[0] ?? null) : linhas.slice(de, ate + 1);
        return Promise.resolve({ data, error: null }).then(ok, ko);
      };
      return q;
    },
  };
}

const ORG = "org-1";
const uuid = (p: string, i: number) => `${p}-${String(i).padStart(32, "0")}`;
function lojaComContatos(n: number) {
  const antigo = new Date(Date.now() - 10 * 24 * 3_600_000).toISOString();
  const contacts = Array.from({ length: n }, (_, i) => ({ id: uuid("c", i), organization_id: ORG, name: `Cliente ${i}`, display_name: null }));
  const crm_leads = contacts.map((c, i) => ({
    id: uuid("l", i),
    organization_id: ORG,
    status: "open",
    title: `Lead ${i}`,
    contact_id: c.id,
    owner_user_id: null,
    owner_kind: null,
    owner_agent_id: null,
    stage_id: "etapa-1",
    pipeline_id: "funil-1",
    last_activity_at: antigo,
    created_at: antigo,
  }));
  const conversations = contacts.map((c, i) => ({ id: uuid("v", i), organization_id: ORG, contact_id: c.id, assignee_kind: "user", is_group: false }));
  // metade com follow-up agendado: tem de sair "em voo", nunca "crítico"
  const cron_jobs = contacts
    .filter((_, i) => i % 2 === 0)
    .map((c) => ({ organization_id: ORG, contact_id: c.id, kind: "at", enabled: true, next_run_at: new Date(Date.now() + 3_600_000).toISOString() }));
  return {
    contacts,
    crm_leads,
    conversations,
    cron_jobs,
    crm_pipelines: [],
    crm_stages: [{ id: "etapa-1", organization_id: ORG, expected_duration_hours: null }],
    organizations: [{ id: ORG, settings: {} }],
    calendar_appointments: [],
    ai_agents: [],
  };
}

describe("teste-guarda: nenhum .in() acima de 100 ids nos caminhos de lista grande", () => {
  it("o banco falso estoura como o Node com mais de 100 ids (o guarda tem dente)", async () => {
    const sonda: Sonda = { maiorIn: 0, estouros: [] };
    const db = bancoFalso({ contacts: [] }, sonda) as unknown as {
      from: (t: string) => { in: (c: string, v: string[]) => PromiseLike<{ error: unknown }> };
    };
    const r = await db.from("contacts").in("id", Array.from({ length: 101 }, (_, i) => `x${i}`));
    expect(r.error).not.toBeNull();
    expect(sonda.estouros).toHaveLength(1);
  });

  it("radar com 500 leads (gerente/guardião): nenhum estouro, e TODO item tem nome e link da conversa", async () => {
    const { carregaRadarDeRisco } = await import("@/lib/leads/radar-de-risco");
    const sonda: Sonda = { maiorIn: 0, estouros: [] };
    const db = bancoFalso(lojaComContatos(500), sonda);
    const r = await carregaRadarDeRisco(db as never, { organizationId: ORG, limit: 500, minHours: 0 });
    expect(sonda.estouros).toEqual([]);
    expect(sonda.maiorIn).toBeLessThanOrEqual(IDS_POR_LOTE);
    const itens = (r as { items: Array<{ contact_name: string | null; conversation_id: string | null; in_flight: boolean }> }).items;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((l) => l.contact_name && l.conversation_id)).toBe(true);
    // metade tem follow-up: "em voo" tem de aparecer (antes do lote, saía 0)
    expect(itens.some((l) => l.in_flight)).toBe(true);
  });

  it("risk-watcher com 838 leads (a Fenômenos): nenhum estouro, e quem tem follow-up sai em voo", async () => {
    const { calculaBucketsAtuais } = await import("@/lib/leads/risk-seed");
    const sonda: Sonda = { maiorIn: 0, estouros: [] };
    const db = bancoFalso(lojaComContatos(838), sonda);
    const estados = await calculaBucketsAtuais(db as never, ORG);
    expect(sonda.estouros).toEqual([]);
    expect(estados).toHaveLength(838);
    expect(estados.filter((e) => e.bucket === "em_voo")).toHaveLength(419);
  });

  it("risk-watcher: a leitura de follow-up que falha derruba a rodada (não grava 'crítico' errado)", async () => {
    const { calculaBucketsAtuais } = await import("@/lib/leads/risk-seed");
    const loja = lojaComContatos(5);
    const db = bancoFalso(loja, { maiorIn: 0, estouros: [] });
    const quebrado = {
      from: (t: string) => {
        const q = db.from(t) as Record<string, unknown>;
        if (t === "cron_jobs") q.then = (ok: (r: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "fetch failed" } }).then(ok);
        return q;
      },
    };
    await expect(calculaBucketsAtuais(quebrado as never, ORG)).rejects.toThrow(/follow-ups/);
  });
});

describe("Space do Guardião com ~350 leads: nenhum estouro, a tela não cai", () => {
  const sonda: Sonda = { maiorIn: 0, estouros: [] };
  let loja: ReturnType<typeof lojaComContatos>;
  beforeEach(() => {
    sonda.maiorIn = 0;
    sonda.estouros = [];
    loja = lojaComContatos(350);
    for (const l of loja.crm_leads) Object.assign(l, { owner_user_id: "vendedor-1", sdr_user_id: "guardia-1", source_metadata: null });
    vi.resetModules();
    vi.doMock("@/lib/auth/require-role", () => ({
      requireRole: async () => ({ ok: true, org: { orgId: ORG }, user: { id: "guardia-1" } }),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => bancoFalso(loja, sonda) }));
    vi.doMock("@/lib/iavek/sdr-marca-direto", () => ({ vendedoresDaLoja: async () => [] }));
    vi.doMock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: async () => new Map() }));
  });

  it("responde 200, sem .in() acima de 100, com nome e conversa de todos", async () => {
    const { GET } = await import("@/app/api/v1/iavek/space-do-guardiao/route");
    const res = await GET();
    expect(sonda.estouros).toEqual([]);
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as { data: unknown };
    const texto = JSON.stringify(corpo.data);
    expect(texto).toContain("Cliente 349");
    expect(texto).toContain(uuid("v", 349));
  });
});

describe("cercas do texto", () => {
  it("os três caminhos não mandam mais a lista inteira de contatos num .in()", () => {
    const radar = readFileSync("lib/leads/radar-de-risco.ts", "utf8");
    const seed = readFileSync("lib/leads/risk-seed.ts", "utf8");
    const space = readFileSync("app/api/v1/iavek/space-do-guardiao/route.ts", "utf8");
    expect(radar).not.toMatch(/\.in\("(contact_id|id)", contactIds\)/);
    expect(seed).not.toMatch(/\.in\("contact_id", contactIds\)/);
    expect(space).not.toMatch(/\.in\("(contact_id|id)", contatos\)/);
  });

  it("o radar não engole mais calado o erro de nome e conversa", () => {
    const radar = readFileSync("lib/leads/radar-de-risco.ts", "utf8");
    expect(radar).toMatch(/if \(followups\.error\) throw/);
    expect(radar).toMatch(/if \(convs\.error\) logger\.warn/);
    expect(radar).toMatch(/if \(contacts\.error\) logger\.warn/);
  });
});

describe("CRM-229: o clone da esteira procura o carro do anúncio, e o desfecho fica no log", () => {
  it("passarParaFollowup chama o casador para o CLONE (nunca para o original), dentro de try", () => {
    const deps = readFileSync("lib/esteira/deps-reais.ts", "utf8");
    const passar = deps.slice(deps.indexOf("async passarParaFollowup("));
    const trecho = passar.slice(0, passar.indexOf("performHumanHandoff") > 0 ? passar.indexOf("performHumanHandoff") : 4000);
    expect(trecho).toMatch(/gravarCarroDoAnuncio\(\s*admin,\s*orgId,\s*clone\.id,/);
    expect(trecho).toMatch(/registrarDesfechoDoCarro\("clone_da_esteira"/);
    expect(trecho.indexOf("try {")).toBeLessThan(trecho.indexOf("gravarCarroDoAnuncio("));
  });

  it("o nascimento também registra o desfecho (não só o erro)", () => {
    const n = readFileSync("lib/leads/nascimento-do-lead.ts", "utf8");
    expect(n).toMatch(/registrarDesfechoDoCarro\("nascimento", organizationId, lead\.id as string, desfecho\)/);
  });

  it("registrarDesfechoDoCarro: gravou/nenhum/empate/ja_tinha em info, erro em warn, sem_anuncio calado", async () => {
    const { logger } = await import("@/lib/logger");
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { registrarDesfechoDoCarro } = await import("@/lib/iavek/carro-do-anuncio-servidor");
    for (const d of ["gravou", "nenhum", "empate", "ja_tinha"] as const) registrarDesfechoDoCarro("clone_da_esteira", ORG, "lead-1", d);
    registrarDesfechoDoCarro("clone_da_esteira", ORG, "lead-1", "sem_anuncio");
    registrarDesfechoDoCarro("nascimento", ORG, "lead-2", "erro", new Error("x"));
    expect(info).toHaveBeenCalledTimes(4);
    expect(info.mock.calls[0]![1]).toMatchObject({ origem: "clone_da_esteira", desfecho: "gravou", lead_id: "lead-1" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toMatchObject({ origem: "nascimento", desfecho: "erro", error: "x" });
    info.mockRestore();
    warn.mockRestore();
  });
});
