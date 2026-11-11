/**
 * ia.vek v1.9.45 (CRM-294): o lead em Compra futura ('future') CONTA CERTO. Não vira "aberto" no funil
 * (D2, aprovada pelo Maestro), aparece no filtro de status do quadro (D3), e a IA e as campanhas o
 * aceitam como situação própria. Os rótulos dizem "Compra futura", nunca o código.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveVocabulary } from "@/lib/kanban/vocabulary";
import { filtersFromParams } from "@/lib/kanban/filters";
import { calcularOrigem, type LeadDaJanela } from "@/lib/metrics/funil";
import { filtroDeAudienciaSchema } from "@/lib/campanhas/audiencia";

const JANELA = { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" };
const lead = (id: string, status: LeadDaJanela["status"]): LeadDaJanela => ({
  id, pipeline_id: "f", stage_id: "e", status, source: "whatsapp", value_cents: 1000, currency: "BRL",
  created_at: "2026-11-05T12:00:00Z", closed_at: status === "won" || status === "lost" ? "2026-11-06T12:00:00Z" : null,
});

describe("v1.9.45 (CRM-294): a Compra futura conta certo", () => {
  it("⭐ D2: no funil, o future tem COLUNA PRÓPRIA (não entra em 'aberto')", () => {
    const linhas = calcularOrigem([lead("a", "open"), lead("b", "future"), lead("c", "future"), lead("d", "lost")], JANELA);
    const por = Object.fromEntries(linhas.map((l) => [l.status, l.quantidade]));
    expect(por).toEqual({ lost: 1, open: 1, future: 2 });
  });

  it("⭐ D2: a rota do funil não transforma o future em 'open'", () => {
    const rota = readFileSync("app/api/v1/metrics/funil/route.ts", "utf8");
    expect(rota).toMatch(/l\.status === "future"/);
  });

  it("⭐ D3: o filtro de status do quadro aceita e oferece 'Compra futura'", () => {
    expect(filtersFromParams(new URLSearchParams("status=future") as never).status).toBe("future");
    expect(readFileSync("components/kanban/FilterBar.tsx", "utf8")).toMatch(/value: "future", label: "Compra futura"/);
  });

  it("a IA (crm_list_leads) e a audiência das campanhas aceitam 'future'", () => {
    expect(readFileSync("lib/mcp/tools/leads.ts", "utf8")).toMatch(/status: z\.enum\(\["open", "won", "lost", "future"\]\)/);
    expect(filtroDeAudienciaSchema.safeParse({ situacoes_do_negocio: ["future"] }).success).toBe(true);
  });

  it("os rótulos dizem 'Compra futura' (painel, vocabulário do funil e o PDF da LGPD)", () => {
    expect(resolveVocabulary(null).future).toBe("Compra futura");
    expect(readFileSync("components/inbox/CRMSidePanel.tsx", "utf8")).toMatch(/future: "Compra futura"/);
    expect(readFileSync("lib/lgpd/pdf-renderer.tsx", "utf8")).toMatch(/statusDoNegocio\[l\.status\]/);
  });
});
