/**
 * ia.vek v1.9.60 (0643, CRM-490): as limpezas automáticas deixam a última rodada registrada, também sem efeito.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { registrarRodada, soContagens } from "@/lib/retencao/registrar-rodada";

function dublar(erro: unknown = null, lanca = false) {
  const upsert = vi.fn(async () => {
    if (lanca) throw new Error("rede caiu");
    return { error: erro };
  });
  const from = vi.fn(() => ({ upsert }));
  return { admin: { from } as never, from, upsert };
}

describe("v1.9.60 (CRM-490): registrarRodada", () => {
  it("grava UMA linha por rotina (upsert por rotina), com a hora e só as contagens", async () => {
    const d = dublar();
    await registrarRodada(d.admin, "data-retention", { jobs_apagados: 0, aviso: "texto livre", tem_resto: false }, "req-1", new Date("2026-11-18T04:40:00Z"));
    expect(d.from).toHaveBeenCalledWith("iavek_rotinas_rodadas");
    expect(d.upsert).toHaveBeenCalledWith(
      { rotina: "data-retention", ultima_em: "2026-11-18T04:40:00.000Z", ultimo_resultado: { jobs_apagados: 0, tem_resto: false }, request_id: "req-1" },
      { onConflict: "rotina" },
    );
  });

  it("rodada SEM efeito também é registrada (é o 'rodou' que faltava)", async () => {
    const d = dublar();
    await registrarRodada(d.admin, "media-retention", { vencidas: 0, orfas: 0, expurgadas: 0, tandas: 1 }, "req-2");
    expect(d.upsert).toHaveBeenCalledTimes(1);
  });

  it("nunca lança: erro do banco ou exceção viram só aviso", async () => {
    await expect(registrarRodada(dublar({ code: "42P01" }).admin, "data-retention", {}, "r")).resolves.toBeUndefined();
    await expect(registrarRodada(dublar(null, true).admin, "data-retention", {}, "r")).resolves.toBeUndefined();
  });

  it("soContagens descarta texto, objeto e número inválido", () => {
    expect(soContagens({ a: 1, b: "x", c: { d: 1 }, e: Number.NaN, f: true, g: null })).toEqual({ a: 1, f: true });
  });

  it("as duas rotas chamam o registro antes de responder, e a regra de auditar só com efeito não mudou", () => {
    const dr = readFileSync(join(process.cwd(), "app/api/v1/cron/data-retention/route.ts"), "utf8");
    const mr = readFileSync(join(process.cwd(), "app/api/v1/cron/media-retention/route.ts"), "utf8");
    expect(dr.indexOf('registrarRodada(')).toBeGreaterThan(-1);
    expect(dr.indexOf('registrarRodada(')).toBeLessThan(dr.lastIndexOf("return ok("));
    expect(dr).toContain("if (houveEfeito(resultado)) {");
    expect(mr).toMatch(/await registrarRodada\(admin, "media-retention", total, requestId\);\s*return ok\(total/);
    expect(mr).toContain("if (total.vencidas + total.orfas + total.expurgadas > 0) {");
  });
});
