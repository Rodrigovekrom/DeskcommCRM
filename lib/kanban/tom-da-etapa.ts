/**
 * O tom da coluna do quadro: quanto mais adiante no funil, mais forte o tom da
 * marca no fundo da coluna (#119). Devolve o NÍVEL da etapa, de 0 (a primeira)
 * a 1 (a última); a cor sai do CSS (`.coluna-da-etapa` em `app/globals.css`),
 * que mistura um stop da rampa de accent ao `--color-surface-elevated`.
 *
 * É pela posição na lista que o quadro mostra, não por `is_won`/`is_lost`: o
 * tom diz "onde estou no funil", e a etapa de ganho ou perda é o fim dele.
 */
export function nivelDaEtapa(indice: number, total: number): number {
  if (total <= 1 || !Number.isFinite(indice)) return 0;
  return Math.min(1, Math.max(0, indice / (total - 1)));
}
