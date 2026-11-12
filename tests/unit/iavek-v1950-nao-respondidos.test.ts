import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { aplicarMostrar, MOSTRAR_PADRAO, naoRespondido, semConversa, ultimaEhDoCliente } from "@/lib/iavek/filtro-nao-respondidos";
import { aplicarConversaNoQuadro } from "@/lib/iavek/ordem-do-quadro";
import { lerPreferenciasDoPipeline, PIPELINE_PADRAO, preferenciasDoPipelineSchema } from "@/lib/iavek/preferencias-de-tela";

/** ia.vek v1.9.50 (Rodrigo, Maestro 211138): o Pipeline mostra por padrão só os NÃO RESPONDIDOS. */

const conversa = (o: { entrou?: string | null; saiu?: string | null; humana?: string | null }) => ({
  id: "c1",
  preview: null,
  last_message_at: null,
  unread: 0,
  last_inbound_at: o.entrou ?? null,
  last_outbound_at: o.saiu ?? null,
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
    expect(naoRespondido(lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", saiu: "2026-11-12T09:00:00Z" })))).toBe(true);
  });
  it("resposta pelo CELULAR ou pela Venda.IA (saída sem usuário) responde", () => {
    expect(naoRespondido(lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", saiu: "2026-11-12T10:05:00Z" })))).toBe(false);
  });
  it("resposta de pessoa pelo CRM responde, mesmo sem o last_outbound_at (payload antigo)", () => {
    expect(naoRespondido(lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", humana: "2026-11-12T10:05:00Z" })))).toBe(false);
  });
  it("conversa sem mensagem do cliente não é 'não respondido'", () => {
    expect(ultimaEhDoCliente(conversa({ saiu: "2026-11-12T10:05:00Z" }))).toBe(false);
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
    lead("open", conversa({ entrou: "2026-11-12T10:00:00Z", saiu: "2026-11-12T11:00:00Z" })), // respondido
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
  it("aplicarConversaNoQuadro leva o last_outbound_at", () => {
    const antes = [{ contact_id: "k1", conversa: conversa({ entrou: "2026-11-12T10:00:00Z" }) }] as never[];
    const [depois] = aplicarConversaNoQuadro(antes, { id: "c1", contact_id: "k1", last_outbound_at: "2026-11-12T10:05:00Z" }) as Array<{ status?: string; conversa: ReturnType<typeof conversa> }>;
    expect(depois.conversa.last_outbound_at).toBe("2026-11-12T10:05:00Z");
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
  it("o quadro traz a última SAÍDA da conversa", () => {
    expect(readFileSync("app/api/v1/pipelines/[id]/board/route.ts", "utf8")).toContain("last_outbound_at");
  });
});
