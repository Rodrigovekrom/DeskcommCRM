/**
 * ia.vek CRM-354 (v1.9.51.3; Maestro 182001, Lupa 182118) — a esteira por loja em PARALELO.
 *
 * Até aqui as organizações rodavam UMA de cada vez (`for … await`). Com ~20 s por loja do tamanho da Fenômenos,
 * cabiam ~12-15 lojas nos 5 min entre as rodadas; da 16ª em diante as do fim da lista nunca rodavam.
 *
 *  - N trabalhadores com uma fila (sem biblioteca nova). A trava continua POR ORGANIZAÇÃO (comTravaDaEsteira):
 *    a mesma loja nunca roda duas vezes junto; lojas diferentes rodam lado a lado.
 *  - `ESTEIRA_CONCORRENCIA` (env do app), padrão 1 = EXATAMENTE o comportamento de antes. Fora de 1..8 = 1.
 *  - ORÇAMENTO: nenhuma loja NOVA começa depois de 240 s do início da rodada (as que sobram saem 'sem_tempo').
 *    O `maxDuration` da rota é do Vercel e não corta nada aqui; quem desiste é o curl do scheduler, só do lado dele.
 *    Uma loja que começou perto dos 240 s e passa da rodada fica protegida pela trava por org: na rodada seguinte
 *    ela sai 'rodada_em_curso' e as outras rodam.
 *  - JUSTIÇA: a loja que rodou há MAIS tempo vai primeiro (quem nunca rodou, antes de todas). A hora fica EM MEMÓRIA
 *    no processo do app (um processo só): depois de um reinício todas começam iguais, na ordem do id. Sem migration.
 *    (Lupa 182714) A hora é gravada no COMEÇO de toda tentativa que pegou a trava (sucesso OU erro); 'rodada_em_curso'
 *    e 'sem_tempo' NÃO gravam. Assim uma loja que falha devagar não fica sempre em 1º.
 */
import { logger } from "@/lib/logger";

export const CONCORRENCIA_MAXIMA = 8;
export const ORCAMENTO_PARA_COMECAR_MS = 240_000;

/** `ESTEIRA_CONCORRENCIA`: um inteiro de 1 a 8; qualquer outra coisa (vazio, 0, 99, 'x') = 1, com aviso. */
export function concorrenciaDaEsteira(valor: string | undefined = process.env.ESTEIRA_CONCORRENCIA): number {
  if (valor === undefined || valor.trim() === "") return 1;
  const n = Number(valor.trim());
  if (Number.isInteger(n) && n >= 1 && n <= CONCORRENCIA_MAXIMA) return n;
  logger.warn("esteira_concorrencia_invalida", { valor: valor.slice(0, 20), usado: 1 });
  return 1;
}

/** A hora (ms) em que cada loja COMEÇOU a última tentativa com a trava pega, neste processo. */
const ultimaRodada = new Map<string, number>();

export function marcarQueRodou(orgId: string, quando: number): void {
  ultimaRodada.set(orgId, quando);
}

/** Só para os testes. */
export function esquecerRodadas(): void {
  ultimaRodada.clear();
}

/** A que rodou há mais tempo primeiro; a que nunca rodou (neste processo) antes de todas; empate pelo id. */
export function ordenarPorJustica<T extends { id: string }>(orgs: readonly T[]): T[] {
  return [...orgs].sort((a, b) => {
    const ta = ultimaRodada.get(a.id) ?? -Infinity;
    const tb = ultimaRodada.get(b.id) ?? -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type ResultadoDoParalelo<T, R> = {
  feitos: Array<{ item: T; valor: R }>;
  semTempo: T[];
  /** O MÁXIMO de itens rodando ao mesmo tempo nesta rodada (a prova da Lupa: com N = 4, nunca mais de 4). */
  maxJuntas: number;
};

/**
 * Roda `trabalho` em até `n` itens ao mesmo tempo, na ordem dada. Nenhum item NOVO começa depois de `orcamentoMs`
 * desde o início (`agora` é injetável para o teste). `trabalho` não pode lançar: o isolamento de erro é de quem chama.
 */
export async function rodarEmParalelo<T, R>(
  itens: readonly T[],
  n: number,
  trabalho: (item: T) => Promise<R>,
  opcoes: { orcamentoMs?: number; agora?: () => number } = {},
): Promise<ResultadoDoParalelo<T, R>> {
  const agora = opcoes.agora ?? Date.now;
  const orcamento = opcoes.orcamentoMs ?? ORCAMENTO_PARA_COMECAR_MS;
  const inicio = agora();
  const feitos: Array<{ item: T; valor: R }> = [];
  const semTempo: T[] = [];
  let proximo = 0;
  let rodando = 0;
  let maxJuntas = 0;

  const trabalhador = async () => {
    for (;;) {
      if (proximo >= itens.length) return;
      if (agora() - inicio > orcamento) {
        while (proximo < itens.length) semTempo.push(itens[proximo++] as T);
        return;
      }
      const item = itens[proximo++] as T;
      rodando += 1;
      maxJuntas = Math.max(maxJuntas, rodando);
      try {
        feitos.push({ item, valor: await trabalho(item) });
      } finally {
        rodando -= 1;
      }
    }
  };

  const quantos = Math.max(1, Math.min(n, itens.length));
  await Promise.all(Array.from({ length: quantos }, () => trabalhador()));
  return { feitos, semTempo, maxJuntas };
}
