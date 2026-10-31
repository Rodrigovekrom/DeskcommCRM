import { describe, expect, it } from "vitest";

import { todasAsPaginas } from "./paginas";

/** Um "servidor" com N linhas e um teto de linhas por resposta (o max_rows). */
function servidor(total: number, maxRows: number) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }));
  const pedidos: Array<[number, number]> = [];
  const pagina = async (de: number, ate: number) => {
    pedidos.push([de, ate]);
    const fim = Math.min(ate + 1, de + maxRows, total);
    return { data: de >= total ? [] : linhas.slice(de, fim), error: null };
  };
  return { pagina, pedidos };
}

describe("todasAsPaginas — lê tudo, com qualquer max_rows", () => {
  it("o teto do servidor MENOR que a página não corta a leitura (o defeito do .limit(2000))", async () => {
    const s = servidor(2_350, 500);
    const r = await todasAsPaginas(s.pagina, { porPagina: 1000 });
    expect(r).toHaveLength(2_350);
    expect(new Set(r.map((x) => x.id)).size).toBe(2_350);
  });

  it("para na página vazia", async () => {
    const s = servidor(3, 1000);
    expect(await todasAsPaginas(s.pagina)).toHaveLength(3);
    expect(s.pedidos.at(-1)).toEqual([3, 1002]);
  });

  it("nada a ler: uma ida só", async () => {
    const s = servidor(0, 1000);
    expect(await todasAsPaginas(s.pagina)).toEqual([]);
    expect(s.pedidos).toHaveLength(1);
  });

  it("erro do banco não vira lista vazia: lança", async () => {
    await expect(todasAsPaginas(async () => ({ data: null, error: { message: "timeout" } }))).rejects.toThrow("timeout");
  });

  it("passa do teto: para e lança, não fica em laço", async () => {
    const s = servidor(10_000, 1000);
    await expect(todasAsPaginas(s.pagina, { teto: 2_500 })).rejects.toThrow("teto");
  });
});
