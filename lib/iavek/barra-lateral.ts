/**
 * ia.vek v1.8.2 — a BARRA LATERAL ENXUTA da conversa (Entrada e janela central).
 *
 * UM LUGAR SÓ: o que fica SEMPRE VISÍVEL, e em que ordem, é esta lista. Tirar
 * uma chave daqui a manda para "Ver mais" (fechado por padrão); trocar a ordem
 * aqui troca na tela. Vendedor, gerente e admin veem igual.
 *
 * O que NÃO está aqui (e por isso fica em "Ver mais"): enriquecimento,
 * marcadores da conversa, acompanhamento (com o padrão da loja), demandas,
 * memória do contato, roteiros, o editor "Negócio e dados da compra", fotos da
 * troca, linha do tempo e acervo.
 */
export const CAMPOS_SEMPRE_VISIVEIS = [
  "nome",
  "telefone",
  "carro_interesse",
  "etapa",
  "vendedor",
  "guardiao",
  "forma_pagamento",
  "parcela_desejavel",
  "tags",
  "observacoes",
] as const;

export type CampoDaBarra = (typeof CAMPOS_SEMPRE_VISIVEIS)[number];
