/**
 * ia.vek v1.9.62 (0648, CRM-535): com o gatilho que leva o lead do vendedor à coluna de entrada dele, as passagens
 * que JÁ escolhem a etapa (negociar → qualificado; o agendamento que muda o dono → agendado-video) movem a ETAPA antes
 * do DONO. Com o dono primeiro, o lead passaria pela coluna e seria movido de novo (2 movimentos, 2 avisos ao guardião).
 * E a migration não tem org fixa: só lê a chave do funil.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(p, "utf8");

describe("a etapa antes do dono, nas passagens que escolhem a etapa", () => {
  it("negociar: moverParaAEtapaDaPassagem(..., 'negociar') vem antes da troca de dono", () => {
    const r = ler("app/api/v1/iavek/passagem/route.ts");
    const ramo = r.slice(r.indexOf('if (p.tipo === "negociar")'), r.indexOf('if (p.tipo === "devolver")'));
    expect(ramo.indexOf('moverParaAEtapaDaPassagem(admin, ctx, lead, "negociar")')).toBeGreaterThan(0);
    expect(ramo.indexOf('moverParaAEtapaDaPassagem(admin, ctx, lead, "negociar")')).toBeLessThan(ramo.indexOf("passarLeadNumaTransacao("));
  });

  it("agendamento que muda o dono: a etapa antes do passarOLeadAoVendedor, e não move duas vezes", () => {
    const r = ler("app/api/v1/iavek/pedidos-de-agendamento/route.ts");
    const antes = r.indexOf('await moverParaAEtapaDaPassagem(admin, ctxDoSdr, antes, "agendamento")');
    expect(antes).toBeGreaterThan(0);
    expect(antes).toBeLessThan(r.indexOf("await passarOLeadAoVendedor(admin"));
    expect(r).toContain('if (!jaMovido) await moverParaAEtapaDaPassagem(admin, ctxDoSdr, lido, "agendamento");');
  });
});

describe("a 0648 é do produto, não da loja", () => {
  it("nenhum id nem slug de org fixo: só a chave etapa_de_entrada_do_vendedor do funil", () => {
    // só o código (os comentários citam o roteiro de dado da loja, que é onde a coluna mora)
    const m = ler("supabase/migrations/20261121190000_0648_iavek_para_atender.sql")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(m).not.toMatch(/fenomenos|para-atender'/);
    expect(m).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/);
    expect(m).toContain("settings->>'etapa_de_entrada_do_vendedor'");
  });
});
