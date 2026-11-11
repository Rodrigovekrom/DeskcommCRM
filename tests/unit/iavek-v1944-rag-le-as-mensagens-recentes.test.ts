/**
 * ia.vek v1.9.44 (P3 da Lupa): a ingestão de conversas do RAG lê as mensagens MAIS RECENTES de uma
 * conversa longa, na ordem do tempo. O dublê corta cada resposta no max_rows simulado (1.000): em
 * ordem crescente sem limite (o código antigo), só o começo da conversa voltava.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { MENSAGENS_POR_CONVERSA, mensagensRecentesDaConversa } from "@/lib/ai/rag/ingest/conversations";

const CORTE = 1000;
const base = Date.parse("2026-09-01T00:00:00.000Z");
const todas = Array.from({ length: 2183 }, (_, i) => ({
  body: `m${i}`,
  direction: i % 2 === 0 ? "inbound" : "outbound",
  sent_at: new Date(base + i * 60_000).toISOString(),
}));

function dubleComCorte() {
  let crescente = true;
  let limite = Number.POSITIVE_INFINITY;
  const cadeia: Record<string, unknown> = {};
  Object.assign(cadeia, {
    select: () => cadeia,
    eq: () => cadeia,
    order: (_c: string, o?: { ascending?: boolean }) => ((crescente = o?.ascending !== false), cadeia),
    limit: (n: number) => ((limite = n), cadeia),
    then: (r: (v: unknown) => unknown) => {
      const ordenadas = [...todas].sort((a, b) => (crescente ? a.sent_at.localeCompare(b.sent_at) : b.sent_at.localeCompare(a.sent_at)));
      return Promise.resolve({ data: ordenadas.slice(0, Math.min(limite, CORTE)), error: null }).then(r);
    },
  });
  return { from: () => cadeia } as never;
}

describe("v1.9.44: o RAG lê as mensagens recentes da conversa", () => {
  it("⭐ conversa de 2.183 mensagens com corte de 1.000: volta o FIM da conversa, na ordem do tempo", async () => {
    const { data, error } = await mensagensRecentesDaConversa(dubleComCorte(), "org", "conv");
    expect(error).toBeNull();
    expect(data).toHaveLength(Math.min(MENSAGENS_POR_CONVERSA, CORTE));
    expect(data.at(-1)!.body).toBe("m2182"); // a última mensagem da conversa está lá
    expect(data[0]!.body).toBe(`m${2183 - data.length}`);
    // na ordem do tempo (a transcrição lê do mais antigo para o mais novo)
    expect(data.every((m, i) => i === 0 || data[i - 1]!.sent_at < m.sent_at)).toBe(true);
  });

  it("o limite fica abaixo do corte da produção (3.000)", () => {
    expect(MENSAGENS_POR_CONVERSA).toBeLessThanOrEqual(3000);
  });
});
