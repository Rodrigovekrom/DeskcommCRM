/**
 * ia.vek v1.9.44 (Lupa): a lista de leads com campo obrigatório faltando não pode tratar como
 * COMPLETO quem ficou de fora da resposta do rpc. O dublê corta cada resposta do rpc em 1.000 linhas
 * (o corte simulado) e há 2.500 leads, TODOS com falta: os 2.500 têm de aparecer.
 */
import { describe, expect, it, vi } from "vitest";

const CORTE = 1000;
const leads = Array.from({ length: 2500 }, (_, i) => ({ id: `l-${String(i).padStart(4, "0")}`, title: `Lead ${i}`, owner_user_id: "v1" }));
const chamadas: number[] = [];

vi.mock("@/lib/auth/require-role", () => ({ requireRole: async () => ({ ok: true, user: {}, org: { orgId: "org" } }) }));
vi.mock("@/lib/iavek/campos-obrigatorios", () => ({ lerConfigDosObrigatorios: () => ({ ativo: true }) }));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: async () => new Map([["v1", "Vendedor"]]) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: {} } }) }) }) }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let faixa: [number, number] = [0, 0];
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, eq: () => q, not: () => q, order: () => q,
        range: (de: number, ate: number) => ((faixa = [de, ate]), q),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: leads.slice(faixa[0], Math.min(faixa[1] + 1, faixa[0] + CORTE)), error: null }).then(r),
      });
      return q;
    },
    rpc: async (_fn: string, args: { p_lead_ids: string[] }) => {
      chamadas.push(args.p_lead_ids.length);
      const todas = args.p_lead_ids.map((lead_id) => ({ lead_id, faltam: ["Carro de interesse"] }));
      return { data: todas.slice(0, CORTE), error: null }; // o corte vale na saída do rpc
    },
  }),
}));

import { GET } from "@/app/api/v1/iavek/obrigatorios/incompletos/route";

describe("v1.9.44: obrigatórios incompletos com o rpc em lotes", () => {
  it("⭐ 2.500 leads com falta e corte de 1.000 na saída do rpc: os 2.500 aparecem (ninguém vira 'completo')", async () => {
    const res = await GET();
    const corpo = (await res.json()) as { data: { vendedores: Array<{ leads: unknown[] }> } };
    expect(res.status).toBe(200);
    expect(corpo.data.vendedores[0]!.leads).toHaveLength(2500);
    expect(Math.max(...chamadas)).toBeLessThanOrEqual(CORTE);
  });
});
