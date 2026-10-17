/**
 * ia.vek v1.5: o PRÓXIMO PASSO OBRIGATÓRIO (decisão do Rodrigo).
 *
 * Quem é dono humano da conversa não fecha nem arquiva sem deixar marcado "o
 * quê + quando"; ao trocar de conversa, só recebe um aviso. Enquanto a IA atende,
 * nada é exigido. O próximo passo vira uma tarefa (`crm_tasks`) com prazo, que o
 * cron `tarefas-vencidas` já cobra quando vence.
 */
export const SOURCE_KIND_PROXIMO_PASSO = "proximo_passo";

export interface ConversaDoProximoPasso {
  assignee_kind: string | null;
  assigned_to_user_id: string | null;
  is_group?: boolean | null;
  contact_id?: string | null;
}

/** A conversa exige próximo passo de QUEM está olhando? */
export function exigeProximoPasso(
  conversa: ConversaDoProximoPasso | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (!conversa || !userId) return false;
  if (conversa.is_group) return false;
  if (!conversa.contact_id) return false;
  // Só o humano dono. IA atendendo (assignee_kind 'ai') ou conversa sem dono
  // não exigem nada.
  return conversa.assignee_kind === "user" && conversa.assigned_to_user_id === userId;
}

/** Sugestão de "quando": amanhã às 10h, no horário de quem preenche. */
export function quandoPadrao(agora: Date): Date {
  const d = new Date(agora);
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}
