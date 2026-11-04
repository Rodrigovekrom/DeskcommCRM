/**
 * ia.vek v1.9.16: os tempos das partes de uma rota, no cabeçalho `Server-Timing`.
 * Só nomes fixos e milissegundos: nenhum dado do cliente. O navegador os mostra na
 * aba Rede, o que permite decompor uma rota lenta sem suposição.
 */
export function criarTempos(agora: () => number = () => performance.now()) {
  let ultimo = agora();
  const partes: Array<[string, number]> = [];
  return {
    marcar(nome: string) {
      const t = agora();
      partes.push([nome, t - ultimo]);
      ultimo = t;
    },
    cabecalho(): string {
      return partes.map(([nome, ms]) => `${nome};dur=${ms.toFixed(0)}`).join(", ");
    },
  };
}
