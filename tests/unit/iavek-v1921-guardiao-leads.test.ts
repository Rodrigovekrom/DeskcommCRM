import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FUNCOES, FUNCOES_DE_ESCOLHA, ROTULO_DA_FUNCAO, funcaoMostra } from "@/lib/iavek/funcoes";

describe("v1.9.21: função única Guardião Leads", () => {
  it("suporte sai da escolha e fica no vocabulário gravado; a chave segue sdr", () => {
    expect(FUNCOES_DE_ESCOLHA).not.toContain("suporte");
    expect(FUNCOES).toContain("suporte");
    expect(FUNCOES_DE_ESCOLHA).toContain("sdr");
    expect(ROTULO_DA_FUNCAO.sdr).toBe("Guardião Leads");
  });
  it("o vínculo antigo de suporte segue com o menu dele até ser trocado", () => {
    expect(funcaoMostra("suporte", "/app/inbox")).toBe(true);
  });
});

describe("v1.9.21: a faixa", () => {
  const rota = readFileSync("app/api/v1/iavek/pipeline/faixa-de-ajuda/route.ts", "utf8");
  const tela = readFileSync("app/app/pipeline/_client.tsx", "utf8");
  it("a rota lê e assume pela sessão, nunca com a chave de serviço", () => {
    expect(rota).not.toMatch(/createAdminClient/);
    expect(rota).toMatch(/requireSupportWrite/);
    expect(rota).toMatch(/iavek\.lead_assumido/);
  });
  it("a tela só mostra ao guardião", () => {
    expect(tela).toMatch(/interface_settings\?\.funcao === "sdr"[\s\S]{0,120}FaixaDePedidosDeAjuda/);
  });
  it("a faixa não leva telefone", () => {
    expect(readFileSync("supabase/migrations/20261105030000_0609_iavek_faixa_de_pedidos_de_ajuda.sql", "utf8")).not.toMatch(/phone_number/);
  });
});
