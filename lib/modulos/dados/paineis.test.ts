import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Quais módulos de dados mostram ficha NA tela de uma entidade do núcleo.
 *
 * Duas propriedades, e as duas vêm da doutrina:
 *
 * 1. **Módulo removido não aparece.** Remover é lógico e preserva dados (não-negociável 7): as
 *    tabelas ficam, as telas saem. Um painel que continuasse aparecendo mostraria dado de um módulo
 *    que o administrador desinstalou.
 * 2. **Só o objeto que DECLAROU a referência àquela entidade.** Um objeto sem `refs` de contato não
 *    tem recorte por contato — mostrá-lo na ficha exibiria a lista inteira da organização ali.
 */

const mocks = vi.hoisted(() => ({ rows: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order"]) chain[m] = vi.fn(() => chain);
      chain.then = (r: (v: unknown) => unknown) => r(mocks.rows());
      return chain;
    },
  }),
}));

function instalacao(over: Record<string, unknown> = {}) {
  return {
    publisher: "clinica",
    name: "odontograma",
    removed_at: null,
    extension_artifacts: {
      manifest: {
        profile: "data",
        publisher: "clinica",
        name: "odontograma",
        data: {
          mode: "declarado",
          objetos: [
            {
              slug: "marcacao",
              rotulo: { "pt-BR": "Odontograma" },
              campos: [{ slug: "dente", tipo: "inteiro" }],
              refs: [{ slug: "paciente", entidade: "contato" }],
            },
          ],
        },
      },
    },
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("paineisDaEntidade", () => {
  it("devolve o painel do objeto que declara referência ao contato", async () => {
    mocks.rows.mockReturnValue({ data: [instalacao()], error: null });
    const { paineisDaEntidade } = await import("./paineis");

    expect(await paineisDaEntidade("contato")).toEqual([
      { modulo: "odontograma", objeto: "marcacao" },
    ]);
  });

  it("objeto SEM referência ao contato não vira painel na ficha do contato", async () => {
    const semRef = instalacao();
    (
      semRef.extension_artifacts.manifest.data.objetos[0] as unknown as Record<string, unknown>
    ).refs = [];
    mocks.rows.mockReturnValue({ data: [semRef], error: null });
    const { paineisDaEntidade } = await import("./paineis");

    expect(await paineisDaEntidade("contato")).toEqual([]);
  });

  it("pacote declarativo (sem dados) não contribui painel nenhum", async () => {
    const declarativo = instalacao();
    (declarativo.extension_artifacts.manifest as Record<string, unknown>).profile = "declarative";
    mocks.rows.mockReturnValue({ data: [declarativo], error: null });
    const { paineisDaEntidade } = await import("./paineis");

    expect(await paineisDaEntidade("contato")).toEqual([]);
  });

  it("falha de leitura devolve lista vazia — a ficha do contato não depende disto", async () => {
    mocks.rows.mockReturnValue({ data: null, error: { message: "fora do ar" } });
    const { paineisDaEntidade } = await import("./paineis");

    expect(await paineisDaEntidade("contato")).toEqual([]);
  });
});
