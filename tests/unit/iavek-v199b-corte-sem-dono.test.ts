import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ia.vek 0599 — a data de corte dos leads SEM dono para o guardião (decisão do
 * dono do produto, 31/10). Prova de comportamento: JWT real e sabotagens no
 * banco de teste (provas/prova-seg, fora do repo). Aqui, a forma no baseline.
 */
const base = readFileSync("supabase/baseline.sql", "utf8");
const ultima = (inicio: string) => {
  const i = base.lastIndexOf(inicio);
  expect(i, inicio).toBeGreaterThan(-1);
  return base.slice(i, base.indexOf("$$;", i) + 3);
};
const policy = (nome: string) => {
  const i = base.lastIndexOf(`create policy "${nome}"`);
  return base.slice(i, base.indexOf(";\n", i));
};

describe("0599 — o guardião com data de corte vê só os sem dono novos", () => {
  it("o corte vale só para o GUARDIÃO (agente com função sdr) e só com a chave gravada", () => {
    const f = ultima("create or replace function public.fn_iavek_corte_sem_dono(");
    expect(f).toContain("returns jsonb");
    expect(f).toContain("uo.role = 'agent'");
    expect(f).toContain("uo.interface_settings->>'funcao' = 'sdr'");
    expect(f).toContain("'guardiao_ve_sem_dono_desde'");
  });

  it("a policy lê o mapa UMA vez por consulta (initplan), não a função por linha", () => {
    const p = policy("crm_leads_select");
    expect(p).toMatch(/created_at >= coalesce\(\(\(select public\.fn_iavek_corte_sem_dono\(\)\) ->> organization_id::text\)::timestamptz,\s*'-infinity'::timestamptz\)/);
    // O corte só alcança a cláusula dos SEM dono: dono, guardião e gerência ficam iguais.
    expect(p.match(/fn_iavek_corte_sem_dono/g)?.length).toBe(1);
    expect(p).toMatch(/owner_user_id is null[\s\S]*fn_iavek_corte_sem_dono/);
  });

  it("a função não fica exposta à anon", () => {
    expect(base).toContain("revoke execute on function public.fn_iavek_corte_sem_dono() from public, anon;");
  });
});
