import { describe, expect, it } from "vitest";

import { acharCarroDoAnuncio, relatorioPorCarroDoAnuncio, textoDoAnuncio, type CarroDoCatalogo } from "@/lib/iavek/carro-do-anuncio";

// Nomes no formato do Altimus (marca, modelo, versão, ano, cor, câmbio), inventados.
const C: CarroDoCatalogo[] = [
  { id: "onix20b", nome: "Chevrolet Onix 1.0 LT 2020 Branco Manual", marca: "Chevrolet", ativo: true },
  { id: "onix22p", nome: "Chevrolet Onix 1.0 Premier 2022 Prata Automático", marca: "Chevrolet", ativo: true },
  { id: "hb20s20", nome: "Hyundai HB20S 1.6 Comfort 2020 Branco Manual", marca: "Hyundai", ativo: true },
  { id: "pulse23", nome: "Fiat Pulse 1.0 Audace Turbo 2023 Branco Automático", marca: "Fiat", ativo: false },
  { id: "pulse23b", nome: "Fiat Pulse 1.0 Drive 2023 Preto Manual", marca: "Fiat", ativo: true },
];

describe("v1.9.24: o carro do anúncio", () => {
  it("modelo e ano bastam quando só um casa", () => {
    expect(acharCarroDoAnuncio("🔥 HB20S 2020 com entrada facilitada!", C)).toEqual(expect.objectContaining({ tipo: "achou", id: "hb20s20" }));
  });
  it("a versão desempata dois do mesmo modelo", () => {
    expect(acharCarroDoAnuncio("Onix Premier 2022 automático, venha conferir", C)).toEqual(expect.objectContaining({ id: "onix22p" }));
  });
  it("o ano que o anúncio diz elimina os de outro ano", () => {
    expect(acharCarroDoAnuncio("Onix 2020 impecável", C)).toEqual(expect.objectContaining({ id: "onix20b" }));
  });
  it("só o modelo, sem pista nenhuma, não preenche", () => {
    expect(acharCarroDoAnuncio("Tem Onix na loja!", C).tipo).toBe("nenhum");
  });
  it("dois carros iguais no topo: empate, não preenche", () => {
    const dois = [...C, { id: "hb20s20b", nome: "Hyundai HB20S 1.6 Comfort 2020 Branco Manual", marca: "Hyundai", ativo: true }];
    expect(acharCarroDoAnuncio("HB20S 2020", dois)).toEqual({ tipo: "empate", ids: ["hb20s20", "hb20s20b"] });
  });
  it("com os mesmos pontos, o ativo vence o vendido", () => {
    expect(acharCarroDoAnuncio("Fiat Pulse 2023", C)).toEqual(expect.objectContaining({ id: "pulse23b" }));
  });
  it("o vendido ainda é achado quando é o único que casa", () => {
    expect(acharCarroDoAnuncio("Pulse Audace Turbo 2023", C)).toEqual(expect.objectContaining({ id: "pulse23" }));
  });
  it("anúncio genérico da loja não preenche", () => {
    expect(acharCarroDoAnuncio("Fenômenos Car: o seu próximo carro está aqui", C).tipo).toBe("nenhum");
  });
  it("lê título e corpo guardados no contato", () => {
    expect(textoDoAnuncio({ ad_title: "Onix", ad_body: "LT 2020", ad_source_url: "x" })).toBe("Onix \n LT 2020");
    expect(textoDoAnuncio(null)).toBe("");
  });
});

describe("v1.9.24: o relatório por carro anunciado", () => {
  it("conta leads, vendas e valor vendido por carro; ignora lead sem carro do anúncio", () => {
    const r = relatorioPorCarroDoAnuncio([
      { custom_fields: { carro_anuncio: "a" }, status: "open", value_cents: 100 },
      { custom_fields: { carro_anuncio: "a" }, status: "won", value_cents: 5000000 },
      { custom_fields: { carro_anuncio: "b" }, status: "lost", value_cents: 0 },
      { custom_fields: { carro_interesse: "a" }, status: "won", value_cents: 9 },
      { custom_fields: null, status: "won", value_cents: 9 },
    ]);
    expect(r).toEqual([
      { carro_id: "a", leads: 2, vendas: 1, valor_vendido_cents: 5000000 },
      { carro_id: "b", leads: 1, vendas: 0, valor_vendido_cents: 0 },
    ]);
  });
});
