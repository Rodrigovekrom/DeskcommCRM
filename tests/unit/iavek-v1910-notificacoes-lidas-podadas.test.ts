import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { houveEfeito, podarHistorico, type PodaDb } from "@/app/api/v1/cron/data-retention/route";
import {
  RETENCAO_NOTIFICACOES_DIAS_PADRAO,
  RETENCAO_NOTIFICACOES_DIAS_PISO,
} from "@/lib/retencao/politica";

/**
 * ia.vek (pacote de defeitos D7) — as notificações do sino pessoal (0579)
 * cresciam para sempre. A décima terceira poda do `data-retention` apaga só as
 * JÁ LIDAS, mais velhas que o prazo contado da leitura.
 */
function bancoFalso(lotesDeNotificacao: number[]) {
  const cortes: string[] = [];
  const restante = [...lotesDeNotificacao];
  const db: PodaDb = {
    async rpc() {
      return { data: 0, error: null };
    },
    async apagarRascunhos() {
      return { data: 0, error: null };
    },
    async apagarNotificacoesLidas(corte) {
      cortes.push(corte);
      return { data: restante.shift() ?? 0, error: null };
    },
    async enfileirarMidia() {
      return { data: { vencidas: 0, orfas: 0 }, error: null };
    },
  };
  return { db, cortes };
}

const DIA = 86_400_000;

describe("D7 — a notificação JÁ LIDA do sino sai do banco", () => {
  it("padrão 90 dias, contados da leitura", async () => {
    const { db, cortes } = bancoFalso([0]);
    const antes = Date.now();
    const r = await podarHistorico(db, {});
    expect(RETENCAO_NOTIFICACOES_DIAS_PADRAO).toBe(90);
    expect(r.retencao_notificacoes_dias).toBe(90);
    const corte = Date.parse(cortes[0]!);
    expect(Math.round((antes - corte) / DIA)).toBe(90);
  });

  it("piso de 30 dias: valor menor é elevado, com aviso", async () => {
    const { db } = bancoFalso([0]);
    const r = await podarHistorico(db, { NOTIFICACOES_RETENTION_DAYS: "3" });
    expect(RETENCAO_NOTIFICACOES_DIAS_PISO).toBe(30);
    expect(r.retencao_notificacoes_dias).toBe(30);
    expect(r.avisos.join(" ")).toContain("NOTIFICACOES_RETENTION_DAYS");
  });

  it("drena em lotes e a rodada que só apagou notificação é auditada", async () => {
    const { db } = bancoFalso([1000, 1000, 7]);
    const r = await podarHistorico(db, {});
    expect(r.notificacoes_apagadas).toBe(2007);
    expect(r.lotes_notificacoes).toBe(3);
    expect(r.notificacoes_tem_resto).toBe(false);
    expect(houveEfeito(r)).toBe(true);
  });

  it("o DELETE real só alcança notificação LIDA (aviso não lido nunca sai)", () => {
    const rota = readFileSync("app/api/v1/cron/data-retention/route.ts", "utf8");
    const corpo = rota.slice(rota.indexOf("async apagarNotificacoesLidas("));
    expect(corpo.slice(0, 400)).toMatch(/\.from\("notificacoes"\)\s*\.delete\(\)\s*\.not\("lida_em", "is", null\)\s*\.lt\("lida_em", lidasAntesDe\)/);
  });
});
