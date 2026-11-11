/**
 * ia.vek v1.9.45 (CRM-294), SIMPLIFICADA pelo Rodrigo em 11/11 (19:48Z): "só o lead organizado naquela coluna do
 * Kanban; não precisa avisar nem informar valor; é só para visão e organizar manualmente".
 * Fica: a coluna, o status 'future' fora da esteira e das cobranças, nunca contar como perdido, e o reabrir.
 * Vira interruptor DESLIGADO: a tarefa dos 7 dias, a faixa da vencida, os 3 avisos, e o mês obrigatório (o mês é opcional).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compraFuturaLigada } from "@/lib/iavek/compra-futura/interruptores";

const M = readFileSync("supabase/migrations/20261111200000_0620_iavek_compra_futura.sql", "utf8");

describe("v1.9.45 (CRM-294): a Compra futura simplificada", () => {
  it("⭐ os 6 interruptores ficam DESLIGADOS de fábrica, e só true liga", () => {
    for (const k of ["acorda_com_mensagem", "aviso_de_preco", "avisar_guardiao", "ligacao_7_dias", "faixa_vencida", "mes_obrigatorio"] as const) {
      expect(compraFuturaLigada({}, k)).toBe(false);
      expect(compraFuturaLigada(null, k)).toBe(false);
      expect(compraFuturaLigada({ iavek: { compra_futura: { [k]: "true" } } }, k)).toBe(false);
      expect(compraFuturaLigada({ iavek: { compra_futura: { [k]: true } } }, k)).toBe(true);
    }
    // nenhuma migration ou script liga nenhum deles
    expect(M).not.toMatch(/"(acorda_com_mensagem|aviso_de_preco|avisar_guardiao|ligacao_7_dias|faixa_vencida|mes_obrigatorio)": true/);
  });

  it("⭐ a tarefa dos 7 dias só roda na esteira com o interruptor ligacao_7_dias", () => {
    const rota = readFileSync("app/api/v1/cron/esteira-vendas/route.ts", "utf8");
    expect(rota).toMatch(/compraFuturaLigada\(org\.settings, "ligacao_7_dias"\)\s*\?\s*await rodarCompraFutura/);
  });

  it("⭐ o MÊS é opcional: o banco só exige com mes_obrigatorio, e o CHECK aceita future sem mês", () => {
    expect(M).toMatch(/if new\.compra_futura_mes is null and public\.fn_iavek_compra_futura_ligada\(new\.organization_id, 'mes_obrigatorio'\) then/);
    expect(M).toMatch(/\(compra_futura_mes is null or status = 'future'\)/);
    expect(M).not.toMatch(/\(status = 'future'\) = \(compra_futura_mes is not null\)/);
    // e, quando vem, ainda não pode estar no passado
    expect(M).toMatch(/if new\.compra_futura_mes is not null\s+and new\.compra_futura_mes < date_trunc/);
  });

  it("a janela da Compra futura aceita confirmar SEM mês (e o texto não promete mais a ligação)", () => {
    const j = readFileSync("components/kanban/CompraFuturaDialog.tsx", "utf8");
    expect(j).toMatch(/const valido = mes === "" \|\| mesValido\(mes\);/);
    expect(j).toMatch(/onConfirm\(mes \|\| null\)/);
    expect(j).not.toMatch(/tarefa para ligar/);
  });

  it("continua valendo: o future reabre ao sair da etapa e nunca é perdido", () => {
    expect(M).toMatch(/if tg_op = 'UPDATE' and old\.status in \('won','lost','future'\) then/);
    expect(M).toMatch(/crm_stages_compra_futura_nao_fecha check \(not \(is_compra_futura and \(is_won or is_lost\)\)\)/);
  });
});
