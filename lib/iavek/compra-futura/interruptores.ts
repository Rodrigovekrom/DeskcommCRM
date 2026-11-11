/**
 * ia.vek v1.9.45 (CRM-294): os interruptores da Compra futura, em settings.iavek.compra_futura. TODOS DESLIGADOS de
 * fábrica: o Rodrigo simplificou em 11/11 ("só o lead organizado naquela coluna do Kanban; não precisa avisar nem
 * informar valor; é só para visão e organizar manualmente"). Só `true` liga (string, 1 ou ausente: desligado).
 * O mesmo vale no banco (fn_iavek_compra_futura_ligada, 0620).
 */
export type InterruptorDaCompraFutura =
  | "acorda_com_mensagem"
  | "aviso_de_preco"
  | "avisar_guardiao"
  | "ligacao_7_dias"
  | "faixa_vencida"
  | "mes_obrigatorio";

export function compraFuturaLigada(settings: unknown, chave: InterruptorDaCompraFutura): boolean {
  const v = (settings as { iavek?: { compra_futura?: Record<string, unknown> } } | null)?.iavek?.compra_futura?.[chave];
  return v === true;
}
