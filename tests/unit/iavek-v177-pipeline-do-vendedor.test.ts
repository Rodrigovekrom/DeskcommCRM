import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ehNovo, rotuloDaFormaDePagamento, temTroca } from "@/components/iavek/DadosDaCompraNoCard";
import { DESTINOS_DA_FUNCAO } from "@/lib/iavek/funcoes";
import type { Lead } from "@/lib/types/leads";

/**
 * ia.vek v1.7.7 — o Pipeline do vendedor (a carteira dele no Kanban).
 */
describe("cartão: troca e forma de pagamento", () => {
  it("troca vem de tem_troca ou das fotos da troca", () => {
    expect(temTroca({ tem_troca: true })).toBe(true);
    expect(temTroca({ troca_fotos: ["m:1"] })).toBe(true);
    expect(temTroca({ tem_troca: false })).toBe(false);
    expect(temTroca({})).toBeNull();
    expect(temTroca(null)).toBeNull();
  });

  it("forma de pagamento usa as três opções da ficha da compra (v1.5)", () => {
    expect(rotuloDaFormaDePagamento("a_vista")).toBe("À vista");
    expect(rotuloDaFormaDePagamento("financiamento")).toBe("Financiado");
    expect(rotuloDaFormaDePagamento("consorcio")).toBe("Consórcio");
    expect(rotuloDaFormaDePagamento("outra")).toBeNull();
  });

  it("'Novo': chegou nas últimas 24 h ou tem mensagem sem ler", () => {
    const agora = Date.parse("2026-10-22T12:00:00Z");
    const lead = (criado: string, unread = 0) => ({ created_at: criado, conversa: { unread } }) as unknown as Lead;
    expect(ehNovo(lead("2026-10-22T02:00:00Z"), agora)).toBe(true);
    expect(ehNovo(lead("2026-10-20T02:00:00Z"), agora)).toBe(false);
    expect(ehNovo(lead("2026-10-20T02:00:00Z", 2), agora)).toBe(true);
  });
});

describe("a carteira é cortada NO SERVIDOR", () => {
  const rota = readFileSync(join(process.cwd(), "app/api/v1/pipelines/[id]/board/route.ts"), "utf8");
  it("?escopo=carteira filtra owner_user_id = quem pede, na consulta de leads", () => {
    expect(rota).toMatch(/searchParams\.get\("escopo"\) === "carteira"/);
    expect(rota).toMatch(/consultaDeLeads\.eq\("owner_user_id", user\.id\)/);
  });

  it("o vendedor tem o Pipeline no menu; o gerente segue com o Kanban por vendedor (v1.9.8: no Pipeline da loja)", () => {
    expect(DESTINOS_DA_FUNCAO.vendedor).toContain("/app/pipeline");
    expect(DESTINOS_DA_FUNCAO.gerente).toContain("/app/pipeline");
  });
});

describe("assumir só pega lead SEM dono", () => {
  const rota = readFileSync(join(process.cwd(), "app/api/v1/iavek/pipeline/assumir/route.ts"), "utf8");
  it("o update do dono é condicional a 'sem dono' (corrida = 409)", () => {
    expect(rota).toMatch(/\.is\("owner_user_id", null\)\s*\.is\("owner_agent_id", null\)/);
    expect(rota).toMatch(/Outro vendedor já assumiu este lead\./);
  });
  it("assume a conversa pela mesma RPC do 'Assumir conversa' (o lead segue a conversa)", () => {
    expect(rota).toMatch(/fn_conversation_assign/);
    expect(rota).toMatch(/p_enforce_expected: true/);
  });
});

describe("arrastar para uma etapa de perda pede o motivo", () => {
  const quadro = readFileSync(join(process.cwd(), "components/kanban/KanbanBoard.tsx"), "utf8");
  it("soltar em etapa is_lost abre a janela de perda em vez de mover", () => {
    expect(quadro).toMatch(/etapaDeDestino\?\.is_lost[\s\S]{0,300}setPerdaPendente\(lead\.id\)/);
    expect(quadro).toMatch(/<LoseLeadDialog[\s\S]{0,300}leadId=\{perdaPendente\}/);
  });
});
