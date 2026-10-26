import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getRegisteredHandlers } from "@/lib/event-log/dispatcher";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import { PONTOS_DE_IA } from "@/lib/ai/pontos/registro";
import {
  CRITERIOS_PADRAO,
  LIMITE_DE_CARACTERES,
  MODELO_DA_NOTA,
  comConfigDaNota,
  ehDoVendedor,
  lerConfigDaNota,
  mascarar,
  montarTranscricao,
  promptDoAvaliador,
  quemFalou,
  respostaDaNotaSchema,
} from "@/lib/iavek/nota-do-atendimento";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** ia.vek v1.8.4 — a nota do atendimento do vendedor. */
describe("a chave", () => {
  it("nasce desligada e só liga com o valor gravado", () => {
    expect(lerConfigDaNota(null)).toEqual({ ativo: false });
    expect(lerConfigDaNota({ iavek: {} })).toEqual({ ativo: false });
    expect(lerConfigDaNota({ iavek: { nota_do_atendimento: { ativo: "sim" } } })).toEqual({ ativo: false });
    const s = comConfigDaNota({ iavek: { rodizio: { ativo: true } }, outra: 1 }, { ativo: true });
    expect(lerConfigDaNota(s)).toEqual({ ativo: true });
    expect((s as { outra: number }).outra).toBe(1);
    expect((s as { iavek: { rodizio: unknown } }).iavek.rodizio).toEqual({ ativo: true });
  });
});

describe("o que nunca vai à IA (máscara)", () => {
  it("CPF, RG, CNPJ, telefone, e-mail, placa, chassi e renda saem", () => {
    const t = mascarar(
      "CPF 123.456.789-09, RG 12.345.678-9, CNPJ 12.345.678/0001-90, fone (15) 99258-8914, " +
        "mail joao@exemplo.com, placa ABC-1234 e FBR2C34, chassi 9BWZZZ377VT004251, minha renda é 5 mil",
    );
    for (const vazado of ["123.456.789-09", "12.345.678-9", "0001-90", "99258-8914", "joao@exemplo.com", "ABC-1234", "FBR2C34", "9BWZZZ377VT004251", "5 mil"]) {
      expect(t, vazado).not.toContain(vazado);
    }
    expect(t).toContain("[documento]");
    expect(t).toContain("[placa]");
    expect(t).toContain("[chassi]");
    expect(t).toContain("renda [valor]");
  });
  it("palavra comprida e valor do carro ficam (não são dado pessoal)", () => {
    const t = mascarar("O Onix 2022 sai por R$ 79.900, responsabilidades da loja");
    expect(t).toContain("Onix 2022");
    expect(t).toContain("R$ 79.900");
    expect(t).toContain("responsabilidades");
  });
  it("o nome do cliente vira 'Cliente'", () => {
    expect(mascarar("Oi Maria Souza, tudo bem? maria, posso ligar?", ["Maria Souza"])).toBe("Oi Cliente Cliente, tudo bem? Cliente, posso ligar?");
  });
});

describe("a transcrição", () => {
  const m = (direction: "inbound" | "outbound", sent_via: string | null, body: string | null, min: number, type = "text") => ({
    direction,
    sent_via,
    type,
    body,
    created_at: new Date(Date.UTC(2026, 9, 26, 15, min)).toISOString(),
  });
  it("quem falou: cliente, vendedor (user/crm/celular), IA, sistema", () => {
    expect(quemFalou({ direction: "inbound", sent_via: null })).toBe("CLIENTE");
    for (const v of ["user", "crm", "external_device"]) expect(quemFalou({ direction: "outbound", sent_via: v })).toBe("VENDEDOR");
    expect(quemFalou({ direction: "outbound", sent_via: "ai" })).toBe("IA");
    expect(quemFalou({ direction: "outbound", sent_via: "automation" })).toBe("SISTEMA");
    expect(ehDoVendedor({ direction: "outbound", sent_via: "ai" })).toBe(false);
  });
  it("em ordem, com hora de Brasília, mascarada e mídia como [tipo]", () => {
    const { texto, cortou } = montarTranscricao(
      [m("outbound", "user", "Oi João, temos o Onix", 2), m("inbound", null, "meu cpf 123.456.789-09", 1), m("inbound", null, null, 3, "audio")],
      ["João"],
    );
    expect(cortou).toBe(false);
    expect(texto.split("\n")).toEqual([
      "[26/10, 12:01] CLIENTE: meu cpf [documento]",
      "[26/10, 12:02] VENDEDOR: Oi Cliente, temos o Onix",
      "[26/10, 12:03] CLIENTE: [audio]",
    ]);
  });
  it("atendimento longo: ficam as ÚLTIMAS mensagens e a nota sabe que cortou", () => {
    const muitas = Array.from({ length: 250 }, (_, i) => m("inbound", null, `msg ${i}`, i % 60));
    const r = montarTranscricao(muitas.map((x, i) => ({ ...x, created_at: new Date(Date.UTC(2026, 9, 26, 0, 0, i)).toISOString() })), []);
    expect(r.cortou).toBe(true);
    expect(r.total).toBe(200);
    expect(r.texto).toContain("msg 249");
    expect(r.texto).not.toContain("msg 0\n");
  });
});

describe("nunca passa da faixa de 100 mil tokens do preço de tabela", () => {
  it("mensagens enormes: a transcrição para no teto de caracteres e diz que cortou", () => {
    const grande = "x".repeat(5000);
    const msgs = Array.from({ length: 150 }, (_, i) => ({
      direction: "inbound" as const,
      sent_via: null,
      type: "text",
      body: `${i} ${grande}`,
      created_at: new Date(Date.UTC(2026, 9, 26, 0, 0, i)).toISOString(),
    }));
    const r = montarTranscricao(msgs, []);
    expect(r.texto.length).toBeLessThanOrEqual(LIMITE_DE_CARACTERES);
    expect(r.cortou).toBe(true);
    expect(r.texto).toContain("149 x");
  });
});

describe("recusa e resposta cortada não entram em laço", () => {
  it("content-filter (refusal) e length viram 'pular', sem nova tentativa", () => {
    const w = ler("workers/iavek-nota-do-atendimento.ts");
    expect(w).toContain('fim === "content-filter" ? "recusa_do_modelo"');
    expect(w).toContain('fim === "length" ? "resposta_cortada"');
    expect(w).toContain('if (definitivo) return { status: "skipped", reason: definitivo };');
  });
  it("nada de temperature, budget_tokens ou prefill na chamada (o Haiku 5.5 recusa com 400)", () => {
    const w = ler("workers/iavek-nota-do-atendimento.ts");
    const chamada = w
      .slice(w.indexOf("await generateObject({"), w.indexOf("resposta = gerado.object"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(chamada).not.toMatch(/temperature|topP|topK|budgetTokens|messages:/);
    expect(chamada).toContain('effort: "low"');
  });
});

describe("o avaliador", () => {
  it("usa o claude-haiku-5-5 e os critérios entram no prompt", () => {
    expect(MODELO_DA_NOTA).toBe("anthropic/claude-haiku-5-5");
    const p = promptDoAvaliador(CRITERIOS_PADRAO);
    expect(p).toContain("NÃO fala com o cliente");
    expect(p).toContain("Tentou agendar ou avançar");
  });
  it("a resposta é nota 0–10 com 1–3 pontos de cada lado", () => {
    expect(respostaDaNotaSchema.safeParse({ nota: 7.5, pontos_fortes: ["a"], pontos_a_melhorar: ["b"], trecho: "x" }).success).toBe(true);
    expect(respostaDaNotaSchema.safeParse({ nota: 11, pontos_fortes: ["a"], pontos_a_melhorar: ["b"], trecho: "x" }).success).toBe(false);
    expect(respostaDaNotaSchema.safeParse({ nota: 5, pontos_fortes: [], pontos_a_melhorar: ["b"], trecho: "x" }).success).toBe(false);
  });
  it("o worker não tem caminho de envio: não importa nada de mensagens, canais ou agente", () => {
    const w = ler("workers/iavek-nota-do-atendimento.ts");
    const imports = w.split("\n").filter((l) => l.startsWith("import "));
    for (const proibido of ["messaging", "channels", "waha", "agent-engine/agent", "send", "outbound"]) {
      expect(imports.join("\n"), proibido).not.toContain(proibido);
    }
    expect(w).not.toMatch(/from\("messages"\)\s*\.(insert|upsert|update)/);
    expect(w).toContain("mascarar");
  });
});

describe("a ligação com o resto do sistema", () => {
  it("o handler consome conversation.closed, pula org parada e está registrado", () => {
    ensureHandlersRegistered();
    const h = getRegisteredHandlers().find((x) => x.key === "iavek-nota-do-atendimento.v1");
    expect(h?.events).toEqual(["conversation.closed"]);
    expect(h?.naOrgParada).toBe("pula");
  });
  it("o ponto de IA está no registro", () => {
    const p = PONTOS_DE_IA.find((x) => x.id === "iavek_nota_atendimento");
    expect(p?.emissor).toBe("workers/iavek-nota-do-atendimento.ts");
    expect(p?.registraEm).toBe("llm_calls");
  });
  it("as duas rotas de fechar avisam (só pessoa), e a chave é do admin", () => {
    expect(ler("app/api/v1/conversations/[id]/close/route.ts")).toContain("avisarFechamentoHumano(");
    expect(ler("app/api/v1/conversations/_handler.ts")).toMatch(/input\.status === "closed" && ctx\.actor\.type === "user"\)[\s\S]{0,80}avisarFechamentoHumano/);
    const chave = ler("app/api/v1/iavek/nota-do-atendimento/route.ts");
    expect(chave).toContain('requireRole("admin"');
    for (const r of ["app/api/v1/iavek/notas/route.ts", "app/api/v1/iavek/notas/painel/route.ts"]) {
      expect(ler(r), r).toContain('requireRole("manager"');
      expect(ler(r), r).toContain("createClient()");
    }
  });
  it("o selo só aparece de gerente para cima", () => {
    expect(ler("components/inbox/ConversationHeader.tsx")).toContain("{podeArquivar && <SeloDaNota conversationId={conversation.id} />}");
  });
});
