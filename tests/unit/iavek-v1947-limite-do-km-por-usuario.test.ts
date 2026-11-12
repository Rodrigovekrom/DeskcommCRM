/**
 * ia.vek v1.9.47 (nota 5 da Lupa na v1.9.45): a prévia do km tem limite por usuário, e quem passou dele NÃO chama
 * o OpenRouteService (a cota grátis é da loja inteira).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { LimiteDoKm, PREVIAS_DO_KM_POR_HORA, JANELA_DO_KM_MS } from "@/lib/iavek/km/limite-por-usuario";

describe("LimiteDoKm", () => {
  it("deixa até o limite na janela e recusa a seguinte", () => {
    const l = new LimiteDoKm(3, 1000);
    expect([l.tentar("a", 0), l.tentar("a", 1), l.tentar("a", 2)]).toEqual([true, true, true]);
    expect(l.tentar("a", 3)).toBe(false);
  });
  it("é por usuário: um no limite não trava o outro", () => {
    const l = new LimiteDoKm(1, 1000);
    expect(l.tentar("a", 0)).toBe(true);
    expect(l.tentar("a", 1)).toBe(false);
    expect(l.tentar("b", 1)).toBe(true);
  });
  it("a janela desliza: passada a hora, volta a deixar", () => {
    const l = new LimiteDoKm(2, 1000);
    l.tentar("a", 0); l.tentar("a", 500);
    expect(l.tentar("a", 999)).toBe(false);
    expect(l.tentar("a", 1001)).toBe(true); // a de 0 saiu da janela
    expect(l.tentar("a", 1002)).toBe(false);
  });
  it("a recusa não conta (insistir não prolonga a trava)", () => {
    const l = new LimiteDoKm(1, 1000);
    l.tentar("a", 0);
    for (let t = 1; t < 1000; t += 100) l.tentar("a", t);
    expect(l.tentar("a", 1001)).toBe(true);
  });
  it("o padrão é 30 por hora", () => {
    expect(PREVIAS_DO_KM_POR_HORA).toBe(30);
    expect(JANELA_DO_KM_MS).toBe(3_600_000);
  });
});

const kmDaLojaAte = vi.fn();
vi.mock("@/lib/iavek/km/km-da-loja", () => ({ kmDaLojaAte: (...a: unknown[]) => kmDaLojaAte(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { id: "u-limite" }, org: { orgId: "org-1" } }),
}));

describe("GET /api/v1/iavek/km com o limite", () => {
  beforeEach(() => {
    kmDaLojaAte.mockReset();
    kmDaLojaAte.mockResolvedValue({ endereco: "Rua X, Sorocaba - SP", km: 4.2, motivo: "ok" });
  });
  it("na 31ª prévia da hora responde limite_do_usuario e não chama o km", async () => {
    const { GET } = await import("@/app/api/v1/iavek/km/route");
    const { NextRequest } = await import("next/server");
    const pedir = () => GET(new NextRequest("http://x/api/v1/iavek/km?cep=18030280&numero=1"));
    for (let i = 0; i < PREVIAS_DO_KM_POR_HORA; i++) expect((await pedir()).status).toBe(200);
    expect(kmDaLojaAte).toHaveBeenCalledTimes(PREVIAS_DO_KM_POR_HORA);
    const r = await pedir();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { km: number | null; motivo: string } };
    expect(corpo.data).toMatchObject({ km: null, motivo: "limite_do_usuario" });
    expect(kmDaLojaAte).toHaveBeenCalledTimes(PREVIAS_DO_KM_POR_HORA);
  });
});
