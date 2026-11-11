/**
 * De onde uma `crm_tasks` nasceu — vocabulário ABERTO (sem CHECK no banco,
 * CLAUDE.md doutrina de Migrations). `null`/ausente = criada à mão.
 */
export type TaskSourceKind = "promised_proposal" | "promised_followup";

export const TASK_SOURCE_LABELS: Record<TaskSourceKind, string> = {
  promised_proposal: "Promessa de proposta detectada pelo assistente",
  promised_followup: "Compromisso detectado pelo assistente",
};

/** ia.vek v1.9.46 (0625): o source_kind das tarefas do motor de follow-up (antes, nulo, como as feitas à mão). */
export const FONTE_DA_TAREFA_DE_FOLLOWUP = "followup";

/**
 * ia.vek v1.9.46 (0625): as fontes de PRÉ-VENDA — o GANHO do lead cancela só estas (perder e Compra futura, todas).
 * O espelho em SQL está em fn_iavek_cancela_tarefas_do_lead_fechado (um teste confere os dois). Na dúvida, a tarefa
 * FICA: a feita à mão (nulo), o 'proximo_passo' e as de automação não entram.
 */
export const PREFIXO_DA_PRE_VENDA = "ligacao";
export const FONTES_DA_PRE_VENDA: readonly string[] = [FONTE_DA_TAREFA_DE_FOLLOWUP, "promised_proposal", "promised_followup"];
export function eTarefaDaPreVenda(sourceKind: string | null | undefined): boolean {
  if (!sourceKind) return false;
  return sourceKind.startsWith(PREFIXO_DA_PRE_VENDA) || FONTES_DA_PRE_VENDA.includes(sourceKind);
}
