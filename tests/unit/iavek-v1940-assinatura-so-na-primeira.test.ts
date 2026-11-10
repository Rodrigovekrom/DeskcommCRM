/**
 * ia.vek v1.9.40 (10/11): construído com as recomendações; o Maestro confirma com o Rodrigo antes da troca.
 * Regra recomendada pelo Maestro: o papel aparece quando a mensagem COM TEXTO
 * anterior da conversa NÃO foi minha (vale para humanos e para a IA). Nas
 * seguintes, só o nome em negrito.
 * Contrato proposto:
 *  - precisaIdentificar(anterior, eu): anterior = a última outbound com texto
 *    da conversa (idx_messages_conversation_sent), ou null.
 *  - linhaDeAssinatura(..., { soNome: true }): só a linha do nome, sem a citação.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  aplicarAssinatura,
  configAssinatura,
  linhaDeAssinatura,
  precisaIdentificar,
  semAssinatura,
} from "@/lib/messaging/assinatura";

const FENOMENOS = configAssinatura({
  assinatura_mensagens: {
    humanos: true,
    ia: true,
    nome_ia: "Juliana",
    cabecalhos: {
      ia: { titulo: "Daiane 🚗💛", frase: "Entende o que você busca e apresenta a melhor solução:" },
      funcoes: { sdr: { emoji: "🚗⏳", frase: "Guardião Leads" } },
    },
  },
});

const PALOMA = { tipo: "user" as const, id: "u-paloma" };
const IAGO = { tipo: "user" as const, id: "u-iago" };
const IA = { tipo: "ai" as const };
const msgDe = (quem: typeof PALOMA | typeof IA) =>
  quem.tipo === "ai"
    ? { sent_by_user_id: null, sent_via: "ai" }
    : { sent_by_user_id: quem.id, sent_via: "user" };

describe("v1.9.40 — quando identificar", () => {
  it("1ª mensagem da conversa: identifica", () => {
    expect(precisaIdentificar(null, PALOMA)).toBe(true);
  });
  it("a anterior foi minha: só o nome", () => {
    expect(precisaIdentificar(msgDe(PALOMA), PALOMA)).toBe(false);
  });
  it("assumi de outra pessoa (a anterior foi do Iago): identifica", () => {
    expect(precisaIdentificar(msgDe(IAGO), PALOMA)).toBe(true);
  });
  it("a IA falou no meio: identifica de novo", () => {
    expect(precisaIdentificar(msgDe(IA), PALOMA)).toBe(true);
  });
  it("a IA, depois de uma pessoa: identifica; depois dela mesma: só o nome", () => {
    expect(precisaIdentificar(msgDe(PALOMA), IA)).toBe(true);
    expect(precisaIdentificar(msgDe(IA), IA)).toBe(false);
  });
  it("mensagem do celular (external_device) não conta como minha", () => {
    expect(precisaIdentificar({ sent_by_user_id: null, sent_via: "external_device" }, PALOMA)).toBe(true);
  });
  it("mensagem de automação/sistema (sem pessoa e sem IA) não conta como minha", () => {
    expect(precisaIdentificar({ sent_by_user_id: null, sent_via: "automation" }, PALOMA)).toBe(true);
    expect(precisaIdentificar({ sent_by_user_id: null, sent_via: "automation" }, IA)).toBe(true);
  });
});

describe("v1.9.40 — o formato 'só o nome'", () => {
  it("humano com cabeçalho: só '*Nome emoji*', sem a citação", () => {
    expect(linhaDeAssinatura(FENOMENOS, "user", "paloma souza", "sdr")).toBe("*Paloma 🚗⏳*\n> Guardião Leads\n\n");
    expect(linhaDeAssinatura(FENOMENOS, "user", "paloma souza", "sdr", { soNome: true })).toBe("*Paloma 🚗⏳*\n");
  });
  it("humano sem cabeçalho ('Nome | Rótulo'): só o nome", () => {
    expect(linhaDeAssinatura(FENOMENOS, "user", "lucas lima", "gerente", { soNome: true })).toBe("*Lucas Lima*\n");
  });
  it("IA: só o título", () => {
    expect(linhaDeAssinatura(FENOMENOS, "ai", null, null, { soNome: true })).toBe("*Daiane 🚗💛*\n");
  });
  it("a guarda de eco tira as duas formas", () => {
    const so = aplicarAssinatura(linhaDeAssinatura(FENOMENOS, "user", "paloma", "sdr", { soNome: true }), "Oi!");
    expect(semAssinatura(so ?? "")).toBe("Oi!");
  });
  it("desligado continua desligado", () => {
    const off = configAssinatura({});
    expect(linhaDeAssinatura(off, "user", "paloma", "sdr", { soNome: true })).toBeNull();
  });
});

describe("v1.9.40 — a fiação no envio", () => {
  const fonte = readFileSync("app/api/v1/messages/_handler.ts", "utf8");
  it("lê a última mensagem com texto que SAIU nesta conversa, antes de gravar a nova", () => {
    const i = fonte.indexOf("precisaIdentificar(");
    expect(i).toBeGreaterThan(0);
    const trecho = fonte.slice(fonte.lastIndexOf('.from("messages")', i), i);
    for (const pedaco of ['.eq("conversation_id", c.id)', '.eq("direction", "outbound")', '.not("body", "is", null)', '.neq("status", "failed")', '.order("sent_at", { ascending: false })', ".limit(1)"]) {
      expect(trecho, pedaco).toContain(pedaco);
    }
    // A assinatura é montada ANTES do insert da mensagem nova: a leitura nunca vê a própria mensagem.
    expect(i).toBeLessThan(fonte.indexOf("sent_via: origemDaMensagem(ctx.actor),"));
  });
  it("se a leitura falhar, a pessoa se identifica", () => {
    expect(fonte).toContain("const soNome = !erroAnterior && !precisaIdentificar(");
  });
});
