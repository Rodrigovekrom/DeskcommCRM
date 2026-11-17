/**
 * ia.vek v1.9.60 (CRM-484, 0642): o painel de admin da plataforma lê o gasto de IA DO MÊS pela régua única, em lote.
 * MEDIDO em 17/11 (CRM-483): o contador ai_budgets.current_month_consumed_cents marcava 916,58 centavos na Fenômenos
 * (todo o gasto de outubro) com o gasto do mês em 0,00.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const MIG = readFileSync(join(RAIZ, "supabase/migrations/20261117130000_0642_iavek_gasto_de_ia_em_lote.sql"), "utf8");
const BASE = readFileSync(join(RAIZ, "supabase/baseline.sql"), "utf8");
const ROTA = readFileSync(join(RAIZ, "app/api/v1/admin/dashboard/kpis/route.ts"), "utf8");

const corpoDaFuncao = (sql: string) => {
  const i = sql.indexOf("create or replace function public.fn_gasto_de_ia_do_mes_em_lote");
  return sql.slice(i, sql.indexOf("$$;", i) + 3);
};

describe("v1.9.60 (CRM-484): gasto do mês em lote", () => {
  it("a função em lote CHAMA a régua; não soma cost_cents por conta própria (não é segunda régua)", () => {
    const corpo = corpoDaFuncao(MIG);
    expect(corpo).toContain("public.fn_gasto_de_ia_do_mes(o)");
    expect(corpo).not.toMatch(/sum\s*\(\s*cost_cents/i);
    expect(corpo).not.toMatch(/date_trunc/i);
  });

  it("é security invoker e só o service_role executa (como a régua da 0159)", () => {
    expect(corpoDaFuncao(MIG)).toMatch(/security invoker/);
    expect(MIG).toMatch(/revoke execute on function public\.fn_gasto_de_ia_do_mes_em_lote\(uuid\[\]\)\s+from public, anon, authenticated;/);
    expect(MIG).toMatch(/grant\s+execute on function public\.fn_gasto_de_ia_do_mes_em_lote\(uuid\[\]\)\s+to service_role;/);
  });

  it("o baseline tem o MESMO corpo da migration", () => {
    expect(corpoDaFuncao(BASE)).toBe(corpoDaFuncao(MIG));
  });

  it("a rota usa a função em lote e só cai no acumulado sem ela, com o rótulo dizendo qual", () => {
    expect(ROTA).toContain('admin.rpc("fn_gasto_de_ia_do_mes_em_lote"');
    expect(ROTA).toMatch(/fonteDoGasto === "mes"\s*\?\s*\(gastoDoMes\.get/);
    expect(ROTA).toContain('"gasto do mês"');
    expect(ROTA).toContain('"gasto acumulado"');
    expect(ROTA).not.toMatch(/teto \(gasto acumulado\)`/);
  });
});
