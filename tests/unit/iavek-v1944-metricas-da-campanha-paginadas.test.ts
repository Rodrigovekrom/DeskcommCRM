/**
 * ia.vek v1.9.44 (Lupa): as métricas da campanha contam TODOS os destinatários, mesmo acima do corte
 * do servidor (3.000 na produção). O dublê corta cada resposta em 3 linhas e a campanha tem 7.
 */
import { describe, expect, it, vi } from "vitest";

const CORTE = 3;
const linhas = Array.from({ length: 7 }, (_, i) => ({
  id: `r-${i}`,
  status: "sent",
  eligibility_status: "eligible",
  sent_at: "2026-11-11T10:00:00.000Z",
  delivered_at: null,
  read_at: null,
  replied_at: null,
  opted_out_at: null,
}));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, user: { idioma: "pt-BR" }, org: { orgId: "org" } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let faixa: [number, number] | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        range: (de: number, ate: number) => ((faixa = [de, ate]), q),
        maybeSingle: async () => ({ data: { id: "camp" }, error: null }),
        then: (r: (v: unknown) => unknown) => {
          const base = faixa ? linhas.slice(faixa[0], faixa[1] + 1) : linhas;
          return Promise.resolve({ data: base.slice(0, CORTE), error: null }).then(r);
        },
      });
      return q;
    },
  }),
}));

import { GET } from "@/app/api/v1/campaigns/[id]/metrics/route";

describe("v1.9.44: métricas da campanha paginadas", () => {
  it("⭐ com corte de 3 e 7 destinatários, conta os 7", async () => {
    const res = await GET({} as never, { params: Promise.resolve({ id: "camp" }) });
    const corpo = (await res.json()) as { data: { contagem: { enviados: number }; parcial: boolean } };
    expect(res.status).toBe(200);
    expect(corpo.data.contagem.enviados).toBe(7);
    expect(corpo.data.parcial).toBe(false);
  });
});
