import { describe, expect, it } from "vitest";
import { nivelDaEtapa } from "./tom-da-etapa";

describe("nivelDaEtapa", () => {
  it("vai de 0 na primeira etapa a 1 na última, sempre subindo", () => {
    const niveis = [0, 1, 2, 3, 4].map((i) => nivelDaEtapa(i, 5));
    expect(niveis).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("funil de uma etapa só fica no tom inicial", () => {
    expect(nivelDaEtapa(0, 1)).toBe(0);
  });

  it("nunca sai do intervalo, mesmo com índice fora da lista", () => {
    expect(nivelDaEtapa(-1, 4)).toBe(0);
    expect(nivelDaEtapa(9, 4)).toBe(1);
    expect(nivelDaEtapa(Number.NaN, 4)).toBe(0);
  });
});
