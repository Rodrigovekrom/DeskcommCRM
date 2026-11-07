/**
 * ia.vek v1.9.36 (CRM-260) — a lentidão de Conversas e Pipeline.
 *
 * 1. A policy do analista de ficha (0586) lia `user_organizations` por subconsulta, passando pela RLS dessa
 *    tabela; toda leitura de `organizations` pagava ~55 ms por vez (a conferência de quem está logado, em
 *    todo pedido, pagava duas). A 0614 lê o vínculo por função security definer, com a MESMA regra.
 *    A prova de que cada papel vê as mesmas organizações antes e depois está no relatório do CRM-260
 *    (banco de TESTE, transação desfeita); aqui ficam as cercas do texto.
 * 2. A proteção de agenda (radar de risco e outros) lê os lotes de contatos EM PARALELO, e não um depois
 *    do outro — o resultado é o mesmo.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LOTE_DE_CONTATOS, protecaoAgendaSupabase } from "@/lib/agenda/protecao-followup";

const MIG = readdirSync("supabase/migrations").find((f) => /_0614_/.test(f))!;
const sql = readFileSync(`supabase/migrations/${MIG}`, "utf8");
const baseline = readFileSync("supabase/baseline.sql", "utf8");

describe("0614: a policy do analista sem o custo em todo pedido", () => {
  it("a migration existe, descrita no cabeçalho", () => {
    expect(MIG).toMatch(/^\d{14}_0614_[a-z0-9_]+\.sql$/);
    expect(sql.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.36 \(0614, CRM-260\)/);
  });

  it("a função é security definer, STABLE, search_path fixo, sem SQL dinâmico, e só para quem está logado", () => {
    const f = sql.slice(sql.indexOf("create or replace function public.fn_iavek_orgs_onde_sou_analista"));
    const corpo = f.slice(0, f.indexOf("$$;") + 3);
    expect(corpo).toMatch(/\bstable\b/);
    expect(corpo).toMatch(/security definer/);
    expect(corpo).toMatch(/set search_path = public, pg_temp/);
    expect(corpo).not.toMatch(/\bexecute\b|format\(/i);
    // a MESMA regra da 0586: o próprio usuário, vínculo vivo, função analista_ficha
    expect(corpo).toMatch(/uo\.user_id = auth\.uid\(\)/);
    expect(corpo).toMatch(/uo\.revoked_at is null/);
    expect(corpo).toMatch(/interface_settings->>'funcao' = 'analista_ficha'/);
    expect(sql).toMatch(/revoke execute on function public\.fn_iavek_orgs_onde_sou_analista\(\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.fn_iavek_orgs_onde_sou_analista\(\) to authenticated, service_role;/);
  });

  it("no baseline, a ÚLTIMA definição da policy usa a função, e o bloco entra antes da varredura anon", () => {
    const ultima = baseline.slice(baseline.lastIndexOf("create policy orgs_select_analista_de_ficha"));
    expect(ultima.slice(0, ultima.indexOf(";"))).toMatch(/id in \(select public\.fn_iavek_orgs_onde_sou_analista\(\)\)/);
    const bloco = baseline.lastIndexOf("(migration 0614) ----");
    const varredura = baseline.lastIndexOf("-- ---- VARREDURA anon:");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(varredura);
    expect(baseline.slice(bloco, varredura)).toMatch(/revoke execute on function public\.fn_iavek_orgs_onde_sou_analista\(\) from public, anon;/);
  });
});

describe("proteção de agenda: lotes em paralelo, mesmo resultado", () => {
  it("com 3 lotes de contatos, as leituras correm ao mesmo tempo e devolvem a mesma proteção para cada um", async () => {
    const contatos = Array.from({ length: LOTE_DE_CONTATOS * 2 + 5 }, (_, i) => `c${i}`);
    let emVoo = 0;
    let picoEmVoo = 0;
    const db = {
      from: (table: string) => {
        let cursor = "";
        let lote: string[] = [];
        const q = {
          select: () => q,
          eq: () => q,
          in: (col: string, v: string[]) => {
            if (col === "contact_id") lote = v;
            return q;
          },
          order: () => q,
          limit: () => q,
          gt: (_k: string, v: string) => {
            cursor = v;
            return q;
          },
          single: async () => ({ data: { settings: {} }, error: null }),
          then: (resolve: (v: unknown) => unknown) => {
            emVoo++;
            picoEmVoo = Math.max(picoEmVoo, emVoo);
            // um compromisso futuro só para o contato c201 (3º lote)
            const linhas =
              table === "calendar_appointments" && lote.includes("c201") && cursor === ""
                ? [{ id: "a1", contact_id: "c201", revision: 1, status: "confirmed", starts_at: "2099-01-01T12:00:00Z", ends_at: "2099-01-01T13:00:00Z" }]
                : [];
            return new Promise((r) => setTimeout(r, 5)).then(() => {
              emVoo--;
              return resolve({ data: linhas, error: null });
            });
          },
        };
        return q;
      },
    };
    const m = await protecaoAgendaSupabase(db as never, "org", contatos, new Date("2026-11-07T12:00:00Z"));
    expect(picoEmVoo).toBeGreaterThanOrEqual(3);
    expect(m.size).toBe(contatos.length);
    expect(m.get("c201")).toMatchObject({ adiar: true, appointment_id: "a1" });
    expect(m.get("c0")?.appointment_id ?? null).toBeNull();
  });
});
