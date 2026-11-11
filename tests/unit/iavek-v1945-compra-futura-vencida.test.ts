/**
 * ia.vek v1.9.45 (CRM-294, condição 3 do Maestro): a Compra futura VENCIDA. O mês previsto passou e ninguém
 * agiu: o lead NÃO volta sozinho a aberto (o banco não tem nenhum caminho que faça isso); aparece numa
 * visão para o gerente.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

const e = vi.hoisted(() => ({ filtros: [] as Array<[string, string, unknown]>, papel: "", settings: { iavek: { compra_futura: { faixa_vencida: true } } } as unknown }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async (papel: string) => ((e.papel = papel), { ok: true, user: { idioma: "pt-BR" }, org: { orgId: "org" } })),
}));
vi.mock("@/lib/users/nome-do-atendente", () => ({ nomesDosAtendentes: async () => new Map([["v1", "Vendedor Um"]]) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: (c: string, v: unknown) => (e.filtros.push(["eq", c, v]), q),
        lt: (c: string, v: unknown) => (e.filtros.push(["lt", c, v]), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: { settings: e.settings }, error: null }),
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({
            data: [{ id: "l1", title: "Lead", pipeline_id: "f", compra_futura_mes: "2026-09-01", compra_futura_vendedor_id: "v1", contacts: { name: "Cliente X", display_name: null, phone_number: null } }],
            count: 1,
            error: null,
          }).then(r),
      });
      return q;
    },
  }),
}));

import { GET } from "@/app/api/v1/iavek/compra-futura/vencidas/route";
import { inicioDoMesAtual } from "@/lib/iavek/compra-futura/rodada";

describe("v1.9.45 (CRM-294): Compra futura vencida", () => {
  it("⭐ DESLIGADA de fábrica (Rodrigo simplificou em 11/11): sem o interruptor, a rota não lista nada e a faixa some", async () => {
    e.settings = {};
    e.filtros = [];
    const corpo = (await (await GET()).json()) as { data: { ativo: boolean; total: number; itens: unknown[] } };
    expect(corpo.data).toEqual({ ativo: false, total: 0, itens: [] });
    expect(e.filtros).not.toContainEqual(["eq", "status", "future"]);
    e.settings = { iavek: { compra_futura: { faixa_vencida: true } } };
  });

  it("⭐ LIGADA: só o GERENTE vê; filtra 'future' com o mês ANTES do mês atual; traz o vendedor", async () => {
    const res = await GET();
    const corpo = (await res.json()) as { data: { total: number; itens: Array<Record<string, unknown>> } };
    expect(e.papel).toBe("manager");
    expect(e.filtros).toContainEqual(["eq", "status", "future"]);
    expect(e.filtros).toContainEqual(["lt", "compra_futura_mes", inicioDoMesAtual()]);
    expect(corpo.data.itens[0]).toMatchObject({ id: "l1", cliente: "Cliente X", mes: "2026-09-01", vendedor: "Vendedor Um" });
  });

  it("o 1º dia do mês atual é calculado no fuso de São Paulo", () => {
    expect(inicioDoMesAtual(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11-01"); // 23h de 30/11 em SP
  });

  it("⭐ o lead vencido NÃO volta sozinho a aberto: nenhum caminho do banco sai de 'future' sem trocar de etapa", () => {
    const m = readFileSync("supabase/migrations/20261111200000_0620_iavek_compra_futura.sql", "utf8");
    // o único escritor do status é o gatilho, e ele só sai de 'future' quando a ETAPA não é mais de Compra futura
    expect(m).toMatch(/if tg_op = 'UPDATE' and old\.status in \('won','lost','future'\) then/);
    expect(m).not.toMatch(/update public\.crm_leads set status/i);
    // e a rodada dos 7 dias não muda o status (só cria a tarefa e marca)
    const rodada = readFileSync("lib/iavek/compra-futura/rodada.ts", "utf8");
    expect(rodada).not.toMatch(/status: "open"|stage_id:/);
  });

  it("a faixa aparece só para gerente e admin, na tela do funil", () => {
    const tela = readFileSync("app/app/pipeline/_client.tsx", "utf8");
    expect(tela).toMatch(/\(activeOrg\?\.role === "manager" \|\| activeOrg\?\.role === "admin"\) && <FaixaCompraFuturaVencida \/>/);
  });
});
