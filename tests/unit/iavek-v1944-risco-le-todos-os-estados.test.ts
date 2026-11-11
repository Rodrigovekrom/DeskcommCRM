/**
 * ia.vek v1.9.44 (P2 da Lupa): o observador de risco lê TODOS os estados gravados, mesmo acima do
 * corte do servidor (o max_rows da produção é 3.000; 1.354 estados em 11/11, passando do corte por
 * volta de 07/12).
 *
 * O defeito: a leitura sem paginar parava no corte. Quem ficava de fora virava `de = null` e ganhava
 * uma travessia FALSA a cada passada (upsert e, para em_risco/critico, uma linha "esfriou" na
 * timeline). Aqui o dublê CORTA cada resposta em 3 linhas (o corte simulado) e guarda 7 estados:
 * nenhum pode virar `de = null`, ou seja, com o bucket igual não há travessia nenhuma.
 */
import { describe, expect, it, vi } from "vitest";

import type { EstadoCalculado } from "@/lib/leads/risk-seed";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
const estado = vi.hoisted(() => ({ atuais: [] as EstadoCalculado[] }));
vi.mock("@/lib/leads/risk-seed", () => ({ calculaBucketsAtuais: async () => estado.atuais }));
vi.mock("@/lib/leads/reactivation", () => ({ propoeReativacao: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/leads/activity-emitter", () => ({ emitLeadActivity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/leads/activity-write-failure", () => ({ registraFalhaDeAtividade: vi.fn(async () => undefined) }));

import { observaTravessias } from "@/lib/leads/risk-worker";

const CORTE = 3; // o max_rows simulado do servidor
const ORG = "org";
const AGORA = new Date("2026-12-07T12:00:00Z");
const ids = Array.from({ length: 7 }, (_, i) => `lead-${i}`);

function dubleComCorte(gravados: Array<{ lead_id: string; bucket: string }>) {
  const upserts: string[] = [];
  const db = {
    from: (tabela: string) => {
      if (tabela !== "crm_lead_risk_states") throw new Error("tabela não modelada: " + tabela);
      return {
        select: () => {
          // Sem .range(), o servidor devolve só as primeiras CORTE linhas (o defeito).
          const resposta = { data: gravados.slice(0, CORTE), error: null };
          return {
            eq: () => ({
              then: (r: (v: unknown) => unknown) => Promise.resolve(resposta).then(r),
              order: () => ({
                range: async (de: number, ate: number) => ({
                  data: gravados.slice(de, Math.min(ate + 1, de + CORTE)), // o corte vale por resposta
                  error: null,
                }),
              }),
            }),
          };
        },
        upsert: async (linha: { lead_id: string }) => (upserts.push(linha.lead_id), { error: null }),
      };
    },
  };
  return { db: db as never, upserts };
}

describe("v1.9.44: o observador de risco lê todos os estados gravados", () => {
  it("⭐ com o corte simulado (3 por resposta) e 7 estados, NINGUÉM vira de=null: zero travessias falsas", async () => {
    const gravados = ids.map((id) => ({ lead_id: id, bucket: "em_risco" }));
    estado.atuais = ids.map((leadId) => ({ leadId, contactId: null, bucket: "em_risco", since: AGORA, coldHours: 72 }) as EstadoCalculado);
    const { db, upserts } = dubleComCorte(gravados);

    const r = await observaTravessias(db, ORG, AGORA);

    expect(r.avaliados).toBe(7);
    expect(r.travessias).toBe(0);
    expect(r.esfriaram).toBe(0);
    expect(upserts).toEqual([]);
  });

  it("uma travessia de verdade além do corte continua sendo vista (o lead 6 saiu de em_dia)", async () => {
    const gravados = ids.map((id) => ({ lead_id: id, bucket: "em_dia" }));
    estado.atuais = ids.map((leadId) => ({ leadId, contactId: null, bucket: leadId === "lead-6" ? "em_risco" : "em_dia", since: AGORA, coldHours: 72 }) as EstadoCalculado);
    const { db, upserts } = dubleComCorte(gravados);

    const r = await observaTravessias(db, ORG, AGORA);

    expect(r.travessias).toBe(1);
    expect(upserts).toEqual(["lead-6"]);
  });
});
