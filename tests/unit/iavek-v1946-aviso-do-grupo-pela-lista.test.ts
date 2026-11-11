/**
 * ia.vek v1.9.46 (0623, Maestro 223858): o aviso do grupo (Guardião Leads, CRM-241) entrega pela LISTA do rodízio, e só
 * com a lista vazia cai nas 'sdr'. MEDIDO: com a regra antiga, a conta 'VEK (vendedor)' (função sdr) recebia 1 de cada 3.
 * O comportamento foi provado no banco de TESTE (desfeito): lista com 2 = só elas, em rodízio (inclusive a que não é
 * sdr); lista vazia = uma sdr; o mesmo cliente de novo = 'ja_tem_dono'; 0 mensagens a cliente.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const M = readFileSync("supabase/migrations/20261111230000_0623_iavek_aviso_do_grupo_pela_lista.sql", "utf8");
const B = readFileSync("supabase/baseline.sql", "utf8");
const ultima = (n: string) => {
  const i = B.lastIndexOf(`create or replace function public.${n}(`);
  return B.slice(i, B.indexOf("$$;", B.indexOf("$$", i) + 2));
};

describe("v1.9.46 (0623): o aviso do grupo pela lista do rodízio", () => {
  it("⭐ quem recebe vem da LISTA (settings.iavek.rodizio.participantes), só os membros ATIVOS dela, em rodízio", () => {
    const f = ultima("fn_iavek_aviso_de_ajuda");
    expect(f).toContain("o.settings->'iavek'->'rodizio'->'participantes'");
    expect(f).toMatch(/join public\.user_organizations uo on uo\.organization_id = p_org and uo\.user_id = p\.uid and uo\.revoked_at is null/);
    expect(f).toMatch(/r\.origem = 'aviso_de_ajuda'\) asc nulls first,\s+p\.pos/);
  });

  it("⭐ só com a lista vazia (ou sem nenhum ativo) cai nas 'sdr' ativas", () => {
    const f = ultima("fn_iavek_aviso_de_ajuda");
    const lista = f.indexOf("'participantes'");
    const queda = f.indexOf("if v_guardiao is null then\n    select uo.user_id into v_guardiao");
    expect(queda).toBeGreaterThan(lista);
    expect(f.slice(queda, queda + 400)).toContain("uo.interface_settings->>'funcao' = 'sdr'");
  });

  it("o 'ativo' do rodízio NÃO entra aqui (ele é o dos leads novos, e segue desligado na Fenômenos)", () => {
    const f = ultima("fn_iavek_aviso_de_ajuda");
    expect(f).not.toMatch(/rodizio'->>'ativo'|->'ativo'/);
  });

  it("o resto do corpo segue: a trava, o 'ja_tem_dono', o 'ambiguo' e a entrega pelo rodízio", () => {
    const f = ultima("fn_iavek_aviso_de_ajuda");
    expect(f).toContain("pg_advisory_xact_lock(hashtextextended('iavek_rodizio:' || p_org::text, 0))");
    expect(f).toContain("'ja_tem_dono'::text");
    expect(f).toContain("'ambiguo'::text");
    expect(f).toContain("perform public.fn_iavek_rodizio_entregar(p_org, v_lead.id, v_guardiao, 'aviso_de_ajuda', null);");
  });

  it("a tripla: o manifest e o bloco no baseline, antes da VARREDURA anon", () => {
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.46 \(0623\)/);
    const bloco = B.indexOf("-- ---- ia.vek: o aviso do grupo pela lista do rodízio (migration 0623, v1.9.46) ----");
    expect(bloco).toBeGreaterThan(0);
    expect(bloco).toBeLessThan(B.indexOf("-- ---- VARREDURA anon:"));
  });
});
