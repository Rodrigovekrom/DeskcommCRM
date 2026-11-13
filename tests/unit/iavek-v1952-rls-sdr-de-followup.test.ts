import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** ia.vek v1.9.52 (0635, CRM-254): a RLS do SDR de Follow-up. A prova de verdade (as 8 transições do R3, a visão e o
 *  'não vê a entrada sem dono') rodou no banco de TESTE numa transação desfeita; aqui fica a trava do texto. */
const M = readFileSync("supabase/migrations/20261113020000_0635_iavek_sdr_de_followup_rls.sql", "utf8");

describe("0635 — a RLS do SDR de Follow-up", () => {
  it("o helper vale só para quem é sdr_followup ATIVO (role agent, sem revogação) e pega o funil Follow-up da esteira", () => {
    expect(M).toContain("uo.interface_settings->>'funcao' = 'sdr_followup'");
    expect(M).toContain("uo.revoked_at is null");
    expect(M).toContain("uo.role = 'agent'");
    expect(M).toContain("o.settings->'esteira'->'followup'->>'pipeline_id'");
  });
  it("VER e EDITAR o Follow-up; o WITH CHECK prende o lead no funil (tirar de lá = negado)", () => {
    expect((M.match(/\(organization_id, pipeline_id\) in \(select f\.org_id, f\.pipeline_id from public\.fn_iavek_followups_que_cuido\(\) f\)/g) ?? []).length).toBe(3);
  });
  it("R1/R2: o contato e a conversa só pelos leads ABERTOS do Follow-up", () => {
    expect(M).toContain("where l.status in ('open', 'future') and l.contact_id is not null");
    expect(M).toContain("interface_settings->>'funcao' in ('vendedor', 'sdr_followup')");
  });
  it("R3: o gatilho só no UPDATE direto, só para quem não é gerente, e a mensagem legível", () => {
    expect(M).toContain("if current_user <> 'authenticated' then return new; end if;");
    expect(M).toContain("if public.fn_role_at_least(old.organization_id, 'manager') then return new; end if;");
    expect(M).toContain("Este lead é de outra pessoa; peça ao gerente para passar.");
    expect(M).toContain("is not distinct from old.owner_user_id");
  });
  it("a régua de visão da função existe (a trava da Lupa 153805)", () => {
    expect(M).toContain("when 'sdr_followup' then 'own'");
  });
});
