/**
 * ia.vek v1.9.45 (Maestro 203253): a trava da esteira usa um pool SÓ DELA, e não o pool das requisições (o das telas).
 * MEDIDO em 11/11: a trava segurava 1 das 4 conexões das telas (DB_POOL_MAX=4) por ~19 s a cada 5 min.
 */
import { readFileSync } from "node:fs";

import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  CONEXOES_DAS_TRAVAS_DA_ESTEIRA,
  NOME_DA_CONEXAO_DA_TRAVA,
  poolDasTravasDaEsteira,
} from "@/lib/esteira/trava-da-rodada";

const URL = "postgresql://u:p@127.0.0.1:9/db";

describe("v1.9.45: o pool só das travas da esteira", () => {
  it("⭐ com URL: é OUTRO pool (não o das requisições), com 1 conexão, a mesma URL e o nome iavek-trava-esteira", async () => {
    const base = new pg.Pool({ connectionString: URL, max: 4 });
    const travas = poolDasTravasDaEsteira(base) as pg.Pool;
    expect(travas).not.toBe(base);
    expect(travas.options.max).toBe(CONEXOES_DAS_TRAVAS_DA_ESTEIRA);
    expect(CONEXOES_DAS_TRAVAS_DA_ESTEIRA).toBe(1);
    expect(travas.options.connectionString).toBe(URL);
    expect((travas.options as { application_name?: string }).application_name).toBe(NOME_DA_CONEXAO_DA_TRAVA);
    await Promise.all([base.end(), travas.end()]);
  });

  it("o mesmo pool das travas a cada rodada (um por processo, não um novo a cada 5 min)", async () => {
    const base = new pg.Pool({ connectionString: URL });
    const a = poolDasTravasDaEsteira(base);
    expect(poolDasTravasDaEsteira(base)).toBe(a);
    await Promise.all([base.end(), (a as pg.Pool).end()]);
  });

  it("dublê sem URL (os testes): devolve o próprio pool, e o teste da v1.9.43 segue valendo", () => {
    const duble = { connect: async () => ({}) } as unknown as pg.Pool;
    expect(poolDasTravasDaEsteira(duble)).toBe(duble);
  });

  it("⭐ a rota da esteira pega a trava no pool das travas, nunca direto no pool das requisições", () => {
    const rota = readFileSync("app/api/v1/cron/esteira-vendas/route.ts", "utf8");
    expect(rota).toMatch(/const pool = poolDasTravasDaEsteira\(getRequestPool\(\)\);/);
    expect(rota).not.toMatch(/const pool = getRequestPool\(\);/);
  });
});
