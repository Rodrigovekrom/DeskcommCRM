import { describe, expect, it } from "vitest";

import { extrairVariaveis } from "@/lib/propostas/documento/variaveis";
import { ROTULO_DA_VARIAVEL } from "@/lib/propostas/documento/rotulos-das-variaveis";
import { MODELOS_BASE } from "@/lib/propostas/modelos/catalogo-base";
import { ROTULO_DO_MODELO } from "@/lib/propostas/modelos/rotulos";
import { validarModelo } from "@/lib/propostas/modelos/validar-modelo";

/**
 * ia.vek v1.7.6 — o modelo "Proposta de veículo" da loja de carros.
 * Decisão do dono: sem CPF, RG, placa, chassi nem FIPE no modelo.
 */
describe("modelo-base Proposta de veículo", () => {
  const modelo = MODELOS_BASE.veiculo!;
  const variaveis = modelo.sections.flatMap((s) => extrairVariaveis(s.body));

  it("existe, tem nome legível e passa na mesma validação do editor do admin", () => {
    expect(modelo).toBeDefined();
    expect(ROTULO_DO_MODELO.veiculo).toBe("Proposta de veículo");
    expect(validarModelo({ nome: ROTULO_DO_MODELO.veiculo!, descricao: null, ...modelo })).toEqual([]);
  });

  it("pede veículo, valor, pagamento, troca e aceite", () => {
    for (const v of [
      "veiculo.marca_modelo",
      "veiculo.ano",
      "veiculo.km",
      "investment.total_formatted",
      "pagamento.forma",
      "pagamento.entrada",
      "pagamento.parcelas",
      "troca.veiculo",
      "troca.valor_avaliado",
      "approval.date",
    ]) {
      expect(variaveis).toContain(v);
    }
  });

  it("não tem CPF, RG, placa, chassi nem FIPE", () => {
    const texto = JSON.stringify(modelo).toLowerCase();
    for (const proibido of ["cpf", "rg.", ".rg", "placa", "chassi", "fipe", "renavam"]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it("todo campo do modelo tem nome legível", () => {
    expect(variaveis.filter((v) => !Object.hasOwn(ROTULO_DA_VARIAVEL, v))).toEqual([]);
  });

  it("entrada/parcelas, troca e observações são opcionais (só entram se preenchidas)", () => {
    const porId = new Map(modelo.sections.map((s) => [s.id, s]));
    for (const id of ["financiamento", "troca", "observacoes"]) {
      expect(porId.get(id)).toMatchObject({ required: false, conditional: true });
    }
  });
});

describe("seções opcionais oferecem os campos ao vendedor", () => {
  it("o renderer devolve a condicional sem dado como omitida, e ela some do documento", async () => {
    const { renderizarDocumento } = await import("@/lib/propostas/documento/renderer");
    const r = renderizarDocumento(MODELOS_BASE.veiculo!, {});
    const omitidas = r.secoesOmitidas.map((s) => s.id).sort();
    expect(omitidas).toEqual(["financiamento", "observacoes", "troca"]);
    expect(r.secoes.map((s) => s.id)).not.toContain("troca");
    // nenhuma variável das omitidas vira pendência
    expect(r.variaveisFaltando).not.toContain("troca.veiculo");
  });

  it("preencher um campo da troca faz a seção aparecer e o resto dela virar pendência", async () => {
    const { renderizarDocumento } = await import("@/lib/propostas/documento/renderer");
    const r = renderizarDocumento(MODELOS_BASE.veiculo!, { troca: { veiculo: "Gol 2015" } });
    expect(r.secoes.map((s) => s.id)).toContain("troca");
    expect(r.variaveisFaltando).toContain("troca.valor_avaliado");
    expect(r.secoesOmitidas.map((s) => s.id)).not.toContain("troca");
  });
});

describe("a IA nunca preenche placa, chassi nem FIPE (regra do dono)", () => {
  it("campoProibidoParaIa reconhece pelo caminho e pelo nome, sem acento e sem caixa", async () => {
    const { campoProibidoParaIa } = await import("@/lib/propostas/preencher-com-conversa");
    expect(campoProibidoParaIa({ caminho: "veiculo.placa", rotulo: "Placa" })).toBe(true);
    expect(campoProibidoParaIa({ caminho: "veiculo.numero", rotulo: "Número do CHASSI" })).toBe(true);
    expect(campoProibidoParaIa({ caminho: "veiculo.valor_fipe", rotulo: "Valor" })).toBe(true);
    expect(campoProibidoParaIa({ caminho: "troca.veiculo", rotulo: "Veículo na troca" })).toBe(false);
  });

  it("sugerirValoresDaConversa nem chama o modelo quando só sobram campos proibidos", async () => {
    const { sugerirValoresDaConversa } = await import("@/lib/propostas/preencher-com-conversa");
    const r = await sugerirValoresDaConversa({
      campos: [{ caminho: "veiculo.placa", rotulo: "Placa" }],
      transcricao: "Cliente: a placa é ABC1D23",
      pool: null as never,
      cfg: null as never,
      tenantId: "org",
    });
    expect(r).toEqual([]);
  });
});
