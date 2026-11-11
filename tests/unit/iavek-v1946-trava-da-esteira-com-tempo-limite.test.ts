/**
 * ia.vek v1.9.46 (nota 1 da Lupa, Maestro 234646): o pool da trava da esteira tem 1 conexão. Uma rodada presa no MESMO
 * processo segurava a conexão, e a seguinte ficava esperando por ela para rodar DOBRADA logo depois. Agora: passou do
 * tempo de esperar a conexão (5 s, bem abaixo dos 5 min da rodada) = pula, como "rodada_em_curso". E a transação da
 * trava tem teto de comando e de trava (set local, que o pooler aceita).
 */
import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  TEMPO_PARA_PEGAR_A_CONEXAO_MS,
  TETO_DOS_COMANDOS_DA_TRAVA_MS,
  comTravaDaEsteira,
  eTempoEsgotadoDaConexao,
  poolDasTravasDaEsteira,
} from "@/lib/esteira/trava-da-rodada";

describe("v1.9.46: a trava da esteira nunca espera sem fim", () => {
  it("⭐ o pool das travas desiste da conexão em 5 s (abaixo dos 5 min da rodada)", () => {
    const base = new pg.Pool({ connectionString: "postgres://u:p@127.0.0.1:9/x" });
    const travas = poolDasTravasDaEsteira(base) as pg.Pool;
    expect(travas.options.connectionTimeoutMillis).toBe(TEMPO_PARA_PEGAR_A_CONEXAO_MS);
    expect(TEMPO_PARA_PEGAR_A_CONEXAO_MS).toBeLessThan(5 * 60_000);
  });

  it("⭐ a conexão não veio a tempo (a rodada anterior presa) = PULA, não espera nem dobra", async () => {
    let rodou = false;
    const pool = { connect: async () => { throw new Error("timeout exceeded when trying to connect"); } };
    const r = await comTravaDaEsteira(pool as never, "org-a", async () => { rodou = true; return 1; });
    expect(r).toEqual({ rodou: false });
    expect(rodou).toBe(false);
  });

  it("outro erro de conexão NÃO vira 'pulada' (continua erro, para aparecer)", async () => {
    const pool = { connect: async () => { throw new Error("ECONNREFUSED"); } };
    await expect(comTravaDaEsteira(pool as never, "org-a", async () => 1)).rejects.toThrow("ECONNREFUSED");
    expect(eTempoEsgotadoDaConexao(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("a transação da trava põe os tetos de comando e de trava ANTES do try_lock", async () => {
    const sqls: string[] = [];
    const cliente = {
      query: async (sql: string) => { sqls.push(sql); return { rows: sql.includes("pg_try_advisory_xact_lock") ? [{ travou: true }] : [] }; },
      release: () => undefined,
    };
    const r = await comTravaDaEsteira({ connect: async () => cliente } as never, "org-a", async () => 7);
    expect(r).toEqual({ rodou: true, valor: 7 });
    expect(sqls[0]).toBe("begin");
    expect(sqls[1]).toBe(`set local statement_timeout = ${TETO_DOS_COMANDOS_DA_TRAVA_MS}; set local lock_timeout = ${TETO_DOS_COMANDOS_DA_TRAVA_MS}`);
    expect(sqls[2]).toContain("pg_try_advisory_xact_lock");
    expect(sqls.at(-1)).toBe("rollback");
  });

  it("os tetos NÃO vão como parâmetro de partida da conexão (o pooler pode recusar)", () => {
    const f = readFileSync("lib/esteira/trava-da-rodada.ts", "utf8");
    const pool = f.slice(f.indexOf("new pg.Pool({"), f.indexOf("});", f.indexOf("new pg.Pool({")));
    expect(pool).not.toMatch(/statement_timeout|lock_timeout/);
  });
});
