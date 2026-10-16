// PREÇO EM TRÊS NÍVEIS NO ENVIO (ia.vek D1 — Fenômenos Car).
//
// O módulo puro tem os testes dele (`lib/agent-engine/agent/preco-em-tres-niveis.test.ts`).
// Aqui fica a FIAÇÃO: a trava mora dentro do gate `promise` (a cadeia não muda de
// forma), o envio com fotos grava o carro em `metadata.produto_codigo`, e a leitura
// do contexto recompõe a contagem a partir do histórico e do catálogo.

import { describe, expect, it } from "vitest";
import { promiseGate, type GateContext } from "@/lib/agent-engine/guardrails/before-send";
import { corpoDoEnvio } from "@/lib/agent-engine/edge/crm/send-message";
import {
  contextoDePrecoDaSimulacao,
  lerContextoDePreco,
} from "@/lib/agent-engine/agent/contexto-de-preco";

function ctx(body: string, promise: GateContext["promise"]): GateContext {
  return { body, promise } as unknown as GateContext;
}

describe("gate promise com a regra de preço", () => {
  it("sem a regra (agente comum), valor em R$ passa como sempre passou sem tabela", () => {
    expect(promiseGate.evaluate(ctx("Sai por R$ 89.900", { table: null }))).toEqual({ pass: true });
  });

  it("com a regra e sem autorização, qualquer R$ é vetado com motivo de ensino", () => {
    const v = promiseGate.evaluate(
      ctx("O valor dele é R$ 89.900", { table: null, nivelDePreco: { perguntas: 2, autorizadoCents: null } }),
    );
    expect(v.pass).toBe(false);
    if (!v.pass) {
      expect(v.code).toBe("preco_antes_da_hora");
      expect(v.reason).toContain("preco_perguntas = 2");
    }
  });

  it("com a regra e sem número na resposta, passa", () => {
    const v = promiseGate.evaluate(
      ctx("Esse carro tá em fase final de precificação. À vista ou financiado?", {
        table: null,
        nivelDePreco: { perguntas: 1, autorizadoCents: null },
      }),
    );
    expect(v).toEqual({ pass: true });
  });

  it("autorizado: o valor exato passa; outro valor é vetado", () => {
    const nivel = { perguntas: 3, autorizadoCents: 8990000 };
    expect(promiseGate.evaluate(ctx("O valor dele é R$ 89.900", { table: null, nivelDePreco: nivel }))).toEqual({
      pass: true,
    });
    const v = promiseGate.evaluate(ctx("O valor dele é R$ 85.000", { table: null, nivelDePreco: nivel }));
    expect(v.pass).toBe(false);
  });
});

describe("envio com fotos grava o carro em discussão", () => {
  const base = { tenantId: "org", leadId: "lead", jobId: "job", seq: 1, conversationId: "conv", body: "Olha ele" };
  it("produtoCodigo vira metadata.produto_codigo, ao lado da chave de idempotência", () => {
    expect(corpoDoEnvio({ ...base, produtoCodigo: "ONIX-21" }, "k1").metadata).toEqual({
      idempotency_key: "k1",
      produto_codigo: "ONIX-21",
    });
  });
  it("sem produto, o metadata é o de sempre", () => {
    expect(corpoDoEnvio(base, "k1").metadata).toEqual({ idempotency_key: "k1" });
  });
});

function poolFalso(historico: Array<Record<string, unknown>>, precoCents: number | null) {
  const consultas: string[] = [];
  return {
    consultas,
    query: async (sql: string) => {
      consultas.push(sql);
      if (sql.includes("from messages")) return { rows: historico };
      if (sql.includes("from catalog_products")) return { rows: precoCents === null ? [] : [{ preco_cents: String(precoCents) }] };
      throw new Error("consulta inesperada");
    },
  };
}

describe("lerContextoDePreco — do histórico real", () => {
  const historico = [
    { direction: "inbound", texto: "oi", produto_codigo: null },
    { direction: "outbound", texto: "Olha ele", produto_codigo: "ONIX-21" },
    { direction: "inbound", texto: "quanto custa?", produto_codigo: null },
    { direction: "outbound", texto: "à vista ou financiado?", produto_codigo: null },
    { direction: "inbound", texto: "e o valor?", produto_codigo: null },
    { direction: "inbound", texto: "me passa o preço", produto_codigo: null },
  ];

  it("3ª pergunta com preço no catálogo: autoriza", async () => {
    const pool = poolFalso(historico, 8990000);
    const c = await lerContextoDePreco(pool as never, { tenantId: "org", conversationId: "conv" });
    expect(c).toEqual({ perguntas: 3, produtoCodigo: "ONIX-21", autorizadoCents: 8990000 });
  });

  it("3ª pergunta sem preço no catálogo: não autoriza", async () => {
    const c = await lerContextoDePreco(poolFalso(historico, null) as never, { tenantId: "org", conversationId: "conv" });
    expect(c.autorizadoCents).toBeNull();
  });

  it("antes da 3ª nem consulta o catálogo", async () => {
    const pool = poolFalso(historico.slice(0, 4), 8990000);
    const c = await lerContextoDePreco(pool as never, { tenantId: "org", conversationId: "conv" });
    expect(c).toEqual({ perguntas: 1, produtoCodigo: "ONIX-21", autorizadoCents: null });
    expect(pool.consultas.some((q) => q.includes("catalog_products"))).toBe(false);
  });
});

describe("contextoDePrecoDaSimulacao — a aba Testar", () => {
  it("anteriores + a mensagem de teste, se pedir preço", async () => {
    const c = await contextoDePrecoDaSimulacao(
      poolFalso([], 8990000) as never,
      "org",
      { perguntasAnteriores: 2, produtoCodigo: "ONIX-21" },
      "e aí, quanto custa?",
    );
    expect(c).toEqual({ perguntas: 3, produtoCodigo: "ONIX-21", autorizadoCents: 8990000 });
  });
  it("mensagem que não pede preço não soma", async () => {
    const c = await contextoDePrecoDaSimulacao(
      poolFalso([], 8990000) as never,
      "org",
      { perguntasAnteriores: 2, produtoCodigo: "ONIX-21" },
      "quantos km ele tem?",
    );
    expect(c.perguntas).toBe(2);
    expect(c.autorizadoCents).toBeNull();
  });
});
