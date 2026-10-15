import { describe, expect, it } from "vitest";
import { opcoesDaEntrada } from "./opcoes-da-entrada";

describe("opcoesDaEntrada", () => {
  it("só convite esconde o 'Criar conta'; os outros modos mostram", () => {
    expect(opcoesDaEntrada({ modo: "so_convite", google: "ligado" }).mostrarCadastro).toBe(false);
    expect(opcoesDaEntrada({ modo: "aberto", google: "ligado" }).mostrarCadastro).toBe(true);
    expect(opcoesDaEntrada({ modo: "com_aprovacao", google: "ligado" }).mostrarCadastro).toBe(true);
  });

  it("o Google só aparece com o provedor comprovadamente ligado", () => {
    expect(opcoesDaEntrada({ modo: "aberto", google: "ligado" }).mostrarGoogle).toBe(true);
    expect(opcoesDaEntrada({ modo: "aberto", google: "desligado" }).mostrarGoogle).toBe(false);
    expect(opcoesDaEntrada({ modo: "aberto", google: "desconhecido" }).mostrarGoogle).toBe(false);
  });
});
