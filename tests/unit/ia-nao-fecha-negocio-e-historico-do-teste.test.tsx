// ia.vek (15/10/2026): a IA nunca fecha negócio (trava do sistema, não só do
// prompt) e a aba Testar aceita a conversa ANTES da mensagem de teste.

import { describe, expect, it, vi } from "vitest";
import { recusaDeFechamento, organizacaoDeixaIaFecharNegocio } from "@/lib/agent-engine/agent/ia-nao-fecha-negocio";
import { contextoDePrecoDaSimulacao } from "@/lib/agent-engine/agent/contexto-de-preco";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

describe("a IA nunca fecha negócio", () => {
  it("won e lost são recusados com erro de ensino", () => {
    for (const estado of ["won", "lost"]) {
      const r = recusaDeFechamento(estado, false);
      expect(r?.ok).toBe(false);
      expect(r?.error.code).toBe("fechamento_e_da_equipe");
    }
  });
  it("os outros estados passam", () => {
    for (const estado of ["new", "contacted", "qualifying", "qualified", "negotiating", undefined]) {
      expect(recusaDeFechamento(estado, false)).toBeNull();
    }
  });
  it("a organização que liga o interruptor volta ao comportamento antigo", () => {
    expect(recusaDeFechamento("won", true)).toBeNull();
  });
  it("o interruptor só vale com true explícito; falha de leitura = não permite", async () => {
    const pool = (pode: string | null) => ({ query: async () => ({ rows: [{ pode }] }) });
    expect(await organizacaoDeixaIaFecharNegocio(pool("true") as never, "org")).toBe(true);
    expect(await organizacaoDeixaIaFecharNegocio(pool(null) as never, "org")).toBe(false);
    expect(await organizacaoDeixaIaFecharNegocio(pool("false") as never, "org")).toBe(false);
    const quebrado = { query: async () => { throw new Error("db"); } };
    expect(await organizacaoDeixaIaFecharNegocio(quebrado as never, "org")).toBe(false);
  });
});

describe("histórico na aba Testar", () => {
  it("lerHistorico: uma fala por linha, prefixo cliente/ia, ignora o resto", async () => {
    const { lerHistorico } = await import("@/app/app/ai/agents/[id]/_components/TestPanel");
    expect(
      lerHistorico("cliente: oi, vi o onix\nIA: Boa tarde! Como posso te chamar?\nlinha solta\n  cliente :  Ana  "),
    ).toEqual([
      { autor: "cliente", texto: "oi, vi o onix" },
      { autor: "ia", texto: "Boa tarde! Como posso te chamar?" },
      { autor: "cliente", texto: "Ana" },
    ]);
  });

  it("pedido de preço no histórico conta para a regra dos três níveis", async () => {
    const pool = { query: async () => ({ rows: [{ preco_cents: "6290000" }] }) };
    const c = await contextoDePrecoDaSimulacao(
      pool as never,
      "org",
      { perguntasAnteriores: 0, produtoCodigo: "ONIX-18", historicoDoCliente: ["quanto custa?", "quantos km?", "e o valor?"] },
      "me passa o preço",
    );
    expect(c).toEqual({ perguntas: 3, produtoCodigo: "ONIX-18", autorizadoCents: 6290000 });
  });
});
