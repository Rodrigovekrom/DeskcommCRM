/**
 * ia.vek v1.9.62 (CRM-497, D4): as 2 respostas do Rodrigo que ainda podem mudar, num PONTO ÚNICO (Maestro 171636).
 * Os valores de hoje são as recomendações (P1 SIM, P2 FEITAS); a resposta dele muda só esta linha.
 */
export const REGRAS_DA_PASSAGEM = {
  /** P1: a troca de dono pelo QUADRO (PATCH do lead, fora do botão de passar) também exige as tarefas resolvidas. */
  trocaPeloQuadroExigeTarefasResolvidas: true,
  /** P2: "Resolver todas" marca todas como FEITAS ('feita') ou as CANCELA ('excluir', com o motivo). */
  resolverTodasComo: "feita" as "feita" | "excluir",
  /**
   * P3: na passagem SEM pessoa (72h, reengajo), as promessas da IA ao cliente seguem com o novo dono (true) ou são
   * canceladas como as outras de pessoa (false, hoje). Os source_kind em SOURCE_KINDS_DAS_PROMESSAS.
   */
  promessasDaIaSeguemComONovoDono: false as boolean,
} as const;

/** As promessas da IA ao cliente (lib/tarefas/vocabulario-de-origem.ts). */
export const SOURCE_KINDS_DAS_PROMESSAS: readonly string[] = ["promised_proposal", "promised_followup"];

/** O que a passagem sem pessoa preserva (P3): a lista vai ao banco (fn_iavek_tarefas_da_passagem, p_preservar). */
export function preservadasNaPassagem(): string[] {
  return REGRAS_DA_PASSAGEM.promessasDaIaSeguemComONovoDono ? [...SOURCE_KINDS_DAS_PROMESSAS] : [];
}
