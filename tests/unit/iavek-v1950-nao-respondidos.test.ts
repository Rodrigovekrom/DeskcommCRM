import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { aplicarMostrar, MOSTRAR_PADRAO, naoRespondido, semConversa, ultimaEhDoCliente } from "@/lib/iavek/filtro-nao-respondidos";
import { aplicarConversaNoQuadro, esperandoDesde } from "@/lib/iavek/ordem-do-quadro";
import { lerPreferenciasDoPipeline, PIPELINE_PADRAO, preferenciasDoPipelineSchema } from "@/lib/iavek/preferencias-de-tela";

/** ia.vek v1.9.50 (Rodrigo, Maestro 211138): o Pipeline mostra por padrão só os NÃO RESPONDIDOS. */

const conversa = (o: { entrou?: string | null; resposta?: string | null; humana?: string | null }) => ({
  id: "c1",
  preview: null,
  last_message_at: null,
  unread: 0,
  last_inbound_at: o.entrou ?? null,
  ultima_resposta_em: o.resposta ?? null,
  ultima_resposta_humana_em: o.humana ?? null,
});
const lead = (status: string, c: ReturnType<typeof conversa> | null | undefined) => ({ status, conversa: c }) as never;

describe("o PADRÃO é 'Não respondidos' (fica vermelho se mudar)", () => {
  it("a constante, o padrão das preferências e quem nunca escolheu", () => {
    expect(MOSTRAR_PADRAO).toBe("nao_respondidos");
    expect(PIPELINE_PADRAO.mostrar).toBe("nao_respondidos");
    expect(lerPreferenciasDoPipeline(null).mostrar).toBe("nao_respondidos");
    // preferência gravada ANTES da v1.9.50 (sem o campo): cai no padrão novo
    expect(lerPreferenciasDoPipeline({ ordem: "maior_valor", v: 2, ocultas: [], recolhidas: [] }).mostrar).toBe("nao_respondidos");
  });
  it("a escolha 'Todos' de cada pessoa fica gravada; valor estranho é recusado", () => {
    expect(lerPreferenciasDoPipeline({ mostrar: "todos" }).mostrar).toBe("todos");
    expect(preferenciasDoPipelineSchema.safeParse({ mostrar: "qualquer" }).success).toBe(false);
  });
});

describe("a régua do 'não respondido'", () => {
  it("a última mensagem é do CLIENTE => não respondido", () => {
    expect(naoRespondido(lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", resposta: "2026-11-12T09:00:00Z" })))).toBe(true);
  });
  it("resposta pelo CELULAR ou pela Venda.IA (ultima_resposta_em, 0633) responde", () => {
    expect(naoRespondido(lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", resposta: "2026-11-12T10:05:00Z" })))).toBe(false);
  });
  it("resposta de pessoa pelo CRM responde, mesmo sem o ultima_resposta_em (quadro de antes da 0633)", () => {
    expect(naoRespondido(lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", humana: "2026-11-12T10:05:00Z" })))).toBe(false);
  });
  it("conversa sem mensagem do cliente não é 'não respondido'", () => {
    expect(ultimaEhDoCliente(conversa({ resposta: "2026-11-12T10:05:00Z" }))).toBe(false);
  });
  it("lead SEM conversa aparece (ninguém falou com ele ainda)", () => {
    expect(semConversa(lead("open", null))).toBe(true);
    expect(naoRespondido(lead("open", null))).toBe(true);
    expect(naoRespondido(lead("open", undefined))).toBe(true);
  });
  it("lead fechado (ganho/perdido) nunca entra", () => {
    expect(naoRespondido(lead("won", conversa({ entrou: "2026-11-12T10:00:00Z" })))).toBe(false);
    expect(naoRespondido(lead("lost", null))).toBe(false);
  });
});

describe("aplicarMostrar: o que o quadro mostra e as contagens", () => {
  const leads = [
    lead("open", conversa({ entrou: "2026-11-12T10:00:00Z" })), // não respondido
    lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", resposta: "2026-11-12T11:00:00Z" })), // respondido
    lead("open", null), // sem conversa
  ];
  it("'Não respondidos': só os 2; os contadores N de M", () => {
    const v = aplicarMostrar(leads, "nao_respondidos");
    expect(v.visiveis).toHaveLength(2);
    expect(v.naoRespondidos).toBe(2);
    expect(v.todos).toBe(3);
  });
  it("'Todos': os 3, com as mesmas contagens", () => {
    const v = aplicarMostrar(leads, "todos");
    expect(v.visiveis).toHaveLength(3);
    expect([v.naoRespondidos, v.todos]).toEqual([2, 3]);
  });
});

describe("o tempo real tira o lead da lista quando respondem pelo celular", () => {
  it("aplicarConversaNoQuadro leva o ultima_resposta_em", () => {
    const antes = [{ contact_id: "k1", conversa: conversa({ entrou: "2026-11-12T10:00:00Z" }) }] as never[];
    const [depois] = aplicarConversaNoQuadro(antes, { id: "c1", contact_id: "k1", ultima_resposta_em: "2026-11-12T10:05:00Z" }) as Array<{ status?: string; conversa: ReturnType<typeof conversa> }>;
    expect(depois.conversa.ultima_resposta_em).toBe("2026-11-12T10:05:00Z");
    expect(naoRespondido({ status: "open", conversa: depois.conversa } as never)).toBe(false);
  });
});

describe("as duas telas do quadro usam o filtro (a do funil e o Pipeline da loja)", () => {
  for (const arquivo of ["app/app/pipelines/[id]/_client.tsx", "app/app/pipeline/_client.tsx"]) {
    it(arquivo, () => {
      const s = readFileSync(arquivo, "utf8");
      expect(s).toContain("aplicarMostrar(");
      expect(s).toContain("leads={vista.visiveis}");
      expect(s).toContain("<MostrarNaoRespondidos");
    });
  }
  it("o quadro traz a última RESPOSTA da conversa (0633)", () => {
    expect(readFileSync("app/api/v1/pipelines/[id]/board/route.ts", "utf8")).toContain("ultima_resposta_em");
  });
});

describe("UMA régua só (Maestro 211923): a marca do cartão, o bloco do topo e o 'Sem resposta por vendedor'", () => {
  const entrou = "2026-11-12T10:00:00Z";
  it("a marca APAGA quando a equipe responde pelo celular (antes acendia)", () => {
    const l = { status: "open", conversa: conversa({ entrou, resposta: "2026-11-12T10:05:00Z" }) } as never;
    expect(esperandoDesde(l, "Em atendimento")).toBeNull();
    expect(naoRespondido(l)).toBe(false);
  });
  it("sem resposta: a marca e o filtro concordam", () => {
    const l = { status: "open", conversa: conversa({ entrou }) } as never;
    expect(esperandoDesde(l, "Em atendimento")).toBe(Date.parse(entrou));
    expect(naoRespondido(l)).toBe(true);
  });
  it("a coluna da IA: o filtro inclui; a marca segue de fora (lá quem atende é a IA)", () => {
    const l = { status: "open", conversa: conversa({ entrou }) } as never;
    expect(naoRespondido(l)).toBe(true);
    expect(esperandoDesde(l, "IA Atendendo")).toBeNull();
  });
  it("a migration 0633 NÃO conta as automáticas do sistema", () => {
    const m = readFileSync("supabase/migrations/20261112050000_0633_iavek_ultima_resposta_de_gente.sql", "utf8");
    expect(m).toContain("in ('user', 'external_device', 'ai')");
    expect(m).not.toMatch(/in \([^)]*'(system|automation)'/);
  });
  it("a 0633 usa a HORA DO WHATSAPP (sent_at), a mesma do last_inbound_at (Lupa 215411)", () => {
    const m = readFileSync("supabase/migrations/20261112050000_0633_iavek_ultima_resposta_de_gente.sql", "utf8");
    expect(m).toContain("coalesce(new.sent_at, new.created_at)");
    expect(m).toContain("max(coalesce(sent_at, created_at))");
  });
  it("a resposta do celular de ANTES da mensagem do cliente, chegando DEPOIS (reentrega), não responde", () => {
    // o cliente escreveu às 19:30; o vendedor respondeu pelo celular às 19:20 (a data guardada é a do WhatsApp)
    const l = { status: "open", conversa: conversa({ entrou: "2026-11-12T19:30:00Z", resposta: "2026-11-12T19:20:00Z" }) } as never;
    expect(naoRespondido(l)).toBe(true);
  });
});
