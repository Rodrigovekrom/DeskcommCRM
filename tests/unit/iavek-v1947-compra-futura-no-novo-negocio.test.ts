/**
 * ia.vek v1.9.47 (nota 4 da Lupa na v1.9.45): no funil em modo `novo_negocio`, o lead em Compra futura ('future')
 * volta para uma etapa comum como o MESMO lead (sem 409); ganho e perdido seguem recusados como antes.
 */
import { describe, expect, it } from "vitest";

import { recusaReabertura } from "@/lib/leads/reabertura";

const comum = { is_won: false, is_lost: false };
describe("recusaReabertura com a Compra futura", () => {
  it("future → etapa comum, no novo_negocio: deixa (é o mesmo lead voltando)", () => {
    expect(recusaReabertura({ modo: "novo_negocio", statusAtual: "future", etapaDestino: comum })).toBeNull();
  });
  it("controle: lost e won → etapa comum, no novo_negocio, seguem recusados", () => {
    expect(recusaReabertura({ modo: "novo_negocio", statusAtual: "lost", etapaDestino: comum })).not.toBeNull();
    expect(recusaReabertura({ modo: "novo_negocio", statusAtual: "won", etapaDestino: comum })).not.toBeNull();
  });
  it("no mesmo_registro nada muda", () => {
    expect(recusaReabertura({ modo: "mesmo_registro", statusAtual: "future", etapaDestino: comum })).toBeNull();
    expect(recusaReabertura({ modo: "mesmo_registro", statusAtual: "lost", etapaDestino: comum })).toBeNull();
  });
});
