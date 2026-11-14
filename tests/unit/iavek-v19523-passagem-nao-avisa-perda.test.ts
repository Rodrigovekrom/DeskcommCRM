/**
 * ia.vek v1.9.52.3 (0638; Maestro 002817): a passagem ao Follow-up ('moved_to_another_pipeline') não avisa
 * 'guardiao_perda' nem 'lead_passado' pelo original fechado. A prova de comportamento (4 casos + a volta) foi no banco
 * de TESTE (~/operacao/medidas/v1523-0638-no-teste.txt). Aqui: o texto não deixa a regra escapar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const M = readFileSync(join(process.cwd(), "supabase/migrations/20261114030000_0638_iavek_passagem_nao_avisa_perda.sql"), "utf8");
const codigo = M.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("0638: a passagem não avisa perda", () => {
  it("o manifest da v1.9.52.3 (0638)", () => {
    expect(M.split("\n")[0]).toMatch(/^-- manifest: ia\.vek v1\.9\.52\.3 \(0638\)/);
  });
  it("só redefine a função de aviso (nenhuma tabela, policy ou outra função)", () => {
    expect(codigo.match(/create or replace function/gi)).toHaveLength(1);
    expect(codigo).toContain("FUNCTION public.fn_iavek_notifica_mudanca_do_lead()");
    expect(codigo).not.toMatch(/\b(alter|drop|create) (table|policy|trigger)\b/i);
  });
  it("a passagem = 'lost' + 'moved_to_another_pipeline', NUNCA nula (coalesce)", () => {
    expect(codigo).toContain("v_passagem := coalesce(new.status = 'lost' and new.lost_reason = 'moved_to_another_pipeline', false);");
  });
  it("o 'lead_passado' e o 'guardiao_perda' pulam a passagem; o resto fica igual", () => {
    expect(codigo).toMatch(/and new\.owner_user_id is distinct from v_ator\s+and not v_passagem/);
    expect(codigo).toContain("new.status in ('won', 'lost') and not v_passagem then");
    expect(codigo).toContain("'guardiao_etapa'");
    expect(codigo).toContain("case when new.status = 'won' then 'guardiao_ganho' else 'guardiao_perda' end");
  });
});
