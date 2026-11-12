/**
 * ia.vek v1.9.49 (incidente 12/11, o pg_stat_statements depois da queda do Supabase):
 *  - 0632: a régua de organização do fn_iavek_campos_que_faltam_do_lead consulta o vínculo do usuário ANTES do
 *    fn_user_org_ids (que chama o fn_support_context, ~0,7 ms, uma vez por lead: 861 de 999 ms em 943 leads);
 *  - o painel do Pipeline só busca as tarefas por lead (em lotes) na CARTEIRA; na loja, a leitura de todas as
 *    tarefas abertas já cobre.
 * O resultado igual ao de antes foi provado no banco de TESTE (12 usuários, 17.935 linhas, 0 diferenças).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIG = readFileSync("supabase/migrations/20261112044000_0632_iavek_regua_barata_dos_obrigatorios.sql", "utf8");
const BASE = readFileSync("supabase/baseline.sql", "utf8");
const PAINEL = readFileSync("app/api/v1/iavek/pipeline/painel/route.ts", "utf8");

function ultimaDefinicao(texto: string, fn: string): string {
  const i = texto.lastIndexOf(`create or replace function public.${fn}(`);
  return texto.slice(i, texto.indexOf("$$;", texto.indexOf("$$", i) + 2));
}

describe("0632 — a régua barata dos obrigatórios", () => {
  for (const [nome, texto] of [["migration", MIG], ["baseline (a definição mais nova)", BASE]] as const) {
    it(`${nome}: o vínculo do usuário vem ANTES do fn_user_org_ids, e o caso sem usuário primeiro`, () => {
      const corpo = ultimaDefinicao(texto, "fn_iavek_campos_que_faltam_do_lead");
      const semUsuario = corpo.indexOf("when auth.uid() is null then true");
      const vinculo = corpo.indexOf("from public.user_organizations uo");
      const suporte = corpo.indexOf("else l.organization_id in (select public.fn_user_org_ids())");
      expect(semUsuario).toBeGreaterThan(0);
      expect(vinculo).toBeGreaterThan(semUsuario);
      expect(suporte).toBeGreaterThan(vinculo);
      // a mesma exclusão do fn_user_org_ids: o analista de ficha não passa pelo vínculo
      expect(corpo).toContain("coalesce(uo.interface_settings->>'funcao', '') <> 'analista_ficha'");
      expect(corpo).toContain("uo.revoked_at is null");
    });
  }
});

describe("o painel do Pipeline: a busca de tarefas por lead só na carteira", () => {
  it("a leitura em lotes por lead_id está atrás de recorte.tipo === 'carteira'", () => {
    const i = PAINEL.indexOf("const [tarefasDosLeads, tarefasMinhas, visitas] = await Promise.all([");
    const trecho = PAINEL.slice(i, i + 700);
    expect(trecho).toMatch(/recorte\.tipo === "carteira"\s*\?\s*buscaEmLotes\(idsDosLeads/);
    expect(trecho).toContain("Promise.resolve({ data: []");
  });
});
