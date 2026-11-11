/**
 * ia.vek v1.9.45 (CRM-297, Rodrigo 11/11): o radar de risco olha TODOS os leads abertos. Era
 * `.limit(SCAN_CAP)` (500): numa organização com mais de 500 abertos (a Fenômenos tem 900+), quem não
 * estava entre os 500 mais frios nunca entrava no radar. Agora a leitura é paginada (lerTudo).
 *
 * O dublê corta CADA resposta em 300 linhas (o max_rows simulado) e honra o `limit`: com o código
 * antigo o radar enxergaria no máximo 300 (ou 500, sem corte); com o novo, os 904.
 */
import { describe, expect, it } from "vitest";

import { carregaRadarDeRisco } from "@/lib/leads/radar-de-risco";

const CORTE = 300;
const ORG = "org-1";
const AGORA = new Date("2026-11-11T18:00:00Z");
const leads = Array.from({ length: 904 }, (_, i) => ({
  id: `lead-${String(i).padStart(4, "0")}`,
  title: `Lead ${i}`,
  contact_id: null,
  owner_user_id: "vendedor",
  owner_kind: "user",
  owner_agent_id: null,
  stage_id: "etapa-1",
  // todos frios (30 dias sem movimento), do mais frio para o menos frio
  last_activity_at: new Date(AGORA.getTime() - (30 * 24 + i) * 3_600_000).toISOString(),
  created_at: "2026-01-01T00:00:00Z",
  pipeline_id: "funil-1",
}));

function bancoComCorte() {
  const paginas: Array<[number, number]> = [];
  const from = (tabela: string) => {
    let linhas: Array<Record<string, unknown>> = tabela === "crm_leads" ? [...leads] : [];
    let faixa: [number, number] | null = null;
    let limite = Number.POSITIVE_INFINITY;
    const chain: Record<string, unknown> = {};
    const passa = () => chain;
    Object.assign(chain, {
      select: passa, eq: passa, not: passa, is: passa, in: passa, gt: passa, lt: passa, gte: passa, lte: passa, or: passa,
      order: passa,
      limit: (n: number) => ((limite = n), chain),
      range: (de: number, ate: number) => (tabela === "crm_leads" && paginas.push([de, ate]), (faixa = [de, ate]), chain),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
        linhas = linhas.slice(0, Math.min(limite, CORTE));
        return Promise.resolve({ data: linhas, error: null }).then(res);
      },
    });
    return chain;
  };
  return { db: { from, rpc: async () => ({ data: [], error: null }) } as never, paginas };
}

describe("v1.9.45 (CRM-297): o radar de risco olha todos os leads abertos", () => {
  it("⭐ 904 leads abertos e frios, com corte de 300 por resposta: os 904 entram no radar", async () => {
    const { db, paginas } = bancoComCorte();
    const r = await carregaRadarDeRisco(db, { organizationId: ORG, now: AGORA, limit: 50 });
    expect(r.total).toBe(904);
    expect(r.counts.critico + r.counts.em_risco + r.counts.em_voo).toBe(904);
    expect(r.items).toHaveLength(50); // a lista mostrada continua com o limite da tela
    expect(paginas.length).toBeGreaterThan(1); // leu em páginas
  });
});
