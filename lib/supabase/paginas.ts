/**
 * Lê TODAS as linhas de uma consulta, página por página (`.range(de, ate)`).
 *
 * O PostgREST corta toda resposta no `max_rows` do projeto — um teto que o
 * código não enxerga e que muda de instalação para instalação. Quem pede
 * `.limit(2000)` recebe no máximo `max_rows`, em silêncio, e sem ordem fixa
 * recebe um recorte diferente a cada chamada.
 *
 * Por isso: a consulta TEM de ter ordem estável (ex.: `.order("id")`), e o
 * laço só para quando a página vem VAZIA — não quando vem "menor que o pedido",
 * porque uma página menor pode ser só o teto do servidor. Custa uma ida a mais
 * no fim, e acerta com qualquer `max_rows`.
 *
 * `teto` é a trava de segurança contra um laço sem fim (consulta sem ordem,
 * tabela que cresce no meio da leitura): passou dele, para e lança.
 */
export const LINHAS_POR_PAGINA = 1000;

export async function todasAsPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opcoes: { porPagina?: number; teto?: number } = {},
): Promise<T[]> {
  const porPagina = opcoes.porPagina ?? LINHAS_POR_PAGINA;
  const teto = opcoes.teto ?? 50_000;
  const todas: T[] = [];
  for (;;) {
    const { data, error } = await pagina(todas.length, todas.length + porPagina - 1);
    if (error) throw new Error(error.message);
    const linhas = data ?? [];
    if (linhas.length === 0) return todas;
    todas.push(...linhas);
    if (todas.length > teto) throw new Error(`paginação passou do teto de ${teto} linhas`);
  }
}
