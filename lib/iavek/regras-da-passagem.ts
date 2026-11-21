/**
 * ia.vek v1.9.62 (CRM-497, D4): as 2 respostas do Rodrigo que ainda podem mudar, num PONTO ÚNICO (Maestro 171636).
 * Os valores de hoje são as recomendações (P1 SIM, P2 FEITAS); a resposta dele muda só esta linha.
 */
export const REGRAS_DA_PASSAGEM = {
  /** P1: a troca de dono pelo QUADRO (PATCH do lead, fora do botão de passar) também exige as tarefas resolvidas. */
  trocaPeloQuadroExigeTarefasResolvidas: true,
  /** P2: "Resolver todas" marca todas como FEITAS ('feita') ou as CANCELA ('excluir', com o motivo). */
  resolverTodasComo: "feita" as "feita" | "excluir",
} as const;
