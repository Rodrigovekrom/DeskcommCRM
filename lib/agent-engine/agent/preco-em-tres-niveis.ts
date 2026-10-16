/**
 * PREÇO EM TRÊS NÍVEIS (ia.vek, D1 — Fenômenos Car).
 *
 * O prompt da revenda segura o valor do carro até a 3ª vez que o cliente pede:
 * na 1ª e na 2ª a IA conduz sem número; na 3ª informa o valor exato, se o
 * estoque tiver. Deixado ao modelo, "contar as perguntas" e "não soltar número"
 * viram confiança — este módulo tira as duas coisas do modelo:
 *
 *   1. CONTA, de forma determinística, quantas vezes o cliente pediu o preço do
 *      carro em discussão, a partir do HISTÓRICO da conversa (sem estado novo:
 *      o carro em discussão é o último `produto_codigo` que a IA mandou com fotos,
 *      gravado no `metadata` da mensagem enviada);
 *   2. ENTREGA ao prompt `preco_perguntas` e, só a partir da 3ª pergunta e com
 *      preço no catálogo, `preco_autorizado` (bloco "Contexto comercial");
 *   3. TRAVA o envio: valor em R$ sem autorização, ou diferente do autorizado,
 *      é vetado pelo gate `promise` e volta ao modelo para reescrever.
 *
 * LIGA SÓ QUANDO O PROMPT DO AGENTE PEDE: a regra é do prompt da revenda, e o
 * sinal de que ele a usa é citar `preco_perguntas`. Agente que não cita segue
 * exatamente como antes — nenhum bloco a mais, nenhum veto a mais.
 *
 * Este arquivo é PURO (sem banco). A leitura do histórico e do catálogo mora em
 * `contexto-de-preco.ts`.
 */

/** O prompt do agente usa a regra dos três níveis? */
export function regraDePrecoLigada(systemPrompt: string | null | undefined): boolean {
  return typeof systemPrompt === 'string' && systemPrompt.includes('preco_perguntas');
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Assunto que NÃO é o preço do carro: o prompt diz, em letra, que "pergunta sobre
 * km, ano, versão, parcela, entrada ou troca não conta como pergunta de preço".
 * Ano e versão não precisam estar aqui: "qual o ano?" nem chega a pedir preço — e
 * listá-los barraria "qual o valor desse modelo?".
 * Juros, taxa e financiamento são condição de crédito (do consultor), não o
 * valor do carro; "quanto tempo/quantas portas" são quantidades de outra coisa.
 */
const OUTRO_ASSUNTO =
  /\b(parcela|parcelas|parcelado|parcelar|prestac\w*|entrada|troca|trocar|meu carro|no meu|do meu|pelo meu|km|kms|quilometr\w*|rodad\w*|rodou|juros|taxa|financ\w*|fipe|tempo|dias?|horas?|portas|lugares|cilindr\w*|consumo|litros?|seguro|ipva|documento|frete)\b/;

/** Pergunta direta pelo valor do carro. */
const PEDE_PRECO = [
  /\b(valor|valores|preco|precos)\b/,
  /\bquanto\b/,
  /\b(qto|qnto|qnt|qt)\b/,
  /\bquantos reais\b/,
  /\bpor quanto\b/,
  /\bcusta\b/,
  /\br\$\s*\?/,
];

/**
 * A mensagem do cliente pede o preço do carro?
 *
 * Por ORAÇÃO: "quanto de entrada? e o valor dele?" tem uma oração de entrada (não
 * conta) e uma de preço (conta). Uma oração que fala de outro assunto não conta
 * mesmo que diga "valor" ("qual o valor da parcela?").
 */
export function ehPerguntaDePreco(texto: string | null | undefined): boolean {
  if (typeof texto !== 'string') return false;
  const t = normalizar(texto);
  if (t === '') return false;
  const oracoes = t.split(/[?!.;\n]|,| e o | e a | mas /);
  return oracoes.some((o) => {
    const oracao = o.trim();
    if (oracao === '') return false;
    if (!PEDE_PRECO.some((re) => re.test(oracao))) return false;
    return !OUTRO_ASSUNTO.test(oracao);
  });
}

/** Uma mensagem do histórico, só com o que a contagem precisa. */
export interface MensagemParaContagem {
  direcao: 'inbound' | 'outbound';
  texto: string | null;
  /** `metadata.produto_codigo` da mensagem ENVIADA com as fotos de um produto. */
  produtoCodigo: string | null;
}

/**
 * Conta as perguntas de preço do carro em discussão, em ordem cronológica.
 *
 * - O carro em discussão é o último `produtoCodigo` enviado pela IA.
 * - Trocar de UM carro para OUTRO zera a contagem: as perguntas eram do anterior.
 * - O PRIMEIRO carro não zera: "quanto custa o Onix?" antes das fotos já é a 1ª
 *   pergunta sobre ele, e zerar faria o cliente pedir quatro vezes.
 */
export function contarPerguntasDePreco(mensagens: readonly MensagemParaContagem[]): {
  perguntas: number;
  produtoCodigo: string | null;
} {
  let produto: string | null = null;
  let perguntas = 0;
  for (const m of mensagens) {
    if (m.direcao === 'outbound') {
      const codigo = m.produtoCodigo?.trim() || null;
      if (codigo !== null && codigo !== produto) {
        if (produto !== null) perguntas = 0;
        produto = codigo;
      }
      continue;
    }
    if (ehPerguntaDePreco(m.texto)) perguntas += 1;
  }
  return { perguntas, produtoCodigo: produto };
}

/** A partir de quantas perguntas o valor pode sair. */
export const PERGUNTA_QUE_LIBERA_O_PRECO = 3;

/** "89.900" / "89.900,50" — como o prompt usa em "R$ {preco_autorizado}". */
export function formatarPrecoAutorizado(cents: number): string {
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const inteiro = reais.toLocaleString('pt-BR');
  return centavos === 0 ? inteiro : `${inteiro},${String(centavos).padStart(2, '0')}`;
}

export interface ContextoDePreco {
  perguntas: number;
  produtoCodigo: string | null;
  /** Só com `perguntas >= 3` E preço > 0 no catálogo para o produto em discussão. */
  autorizadoCents: number | null;
}

/** Autoriza o preço do catálogo só a partir da 3ª pergunta. */
export function decidirAutorizacao(
  perguntas: number,
  precoDoCatalogoCents: number | null,
): number | null {
  if (perguntas < PERGUNTA_QUE_LIBERA_O_PRECO) return null;
  if (precoDoCatalogoCents === null || !(precoDoCatalogoCents > 0)) return null;
  return precoDoCatalogoCents;
}

/** O bloco que entra no sufixo do turno, logo depois de "## Agora". */
export function renderContextoComercial(c: ContextoDePreco): string {
  const linhas = ['## Contexto comercial', `preco_perguntas: ${c.perguntas}`];
  if (c.produtoCodigo !== null) linhas.push(`carro_em_discussao: ${c.produtoCodigo}`);
  if (c.autorizadoCents !== null) {
    linhas.push(`preco_autorizado: ${formatarPrecoAutorizado(c.autorizadoCents)}`);
  }
  return linhas.join('\n');
}

/**
 * A trava. `precosNoTexto` são os valores em reais que a regex do gate de
 * promessa achou na resposta candidata (em centavos).
 */
export function decidirPrecoNaResposta(
  precosNoTexto: readonly number[],
  nivel: { perguntas: number; autorizadoCents: number | null },
): { permite: true } | { permite: false; motivo: string } {
  if (precosNoTexto.length === 0) return { permite: true };
  if (nivel.autorizadoCents === null) {
    return {
      permite: false,
      motivo:
        `Valor em R$ ainda não autorizado (preco_perguntas = ${nivel.perguntas}). ` +
        'Reescreva SEM nenhum número de valor — nem do carro, nem de entrada ou parcela — ' +
        'seguindo a regra de preço do seu prompt para esta pergunta.',
    };
  }
  const outro = precosNoTexto.find((v) => v !== nivel.autorizadoCents);
  if (outro !== undefined) {
    return {
      permite: false,
      motivo:
        `O único valor que pode sair é R$ ${formatarPrecoAutorizado(nivel.autorizadoCents)} ` +
        '(preco_autorizado). Reescreva usando só ele, exatamente como veio, sem outro número de valor.',
    };
  }
  return { permite: true };
}
