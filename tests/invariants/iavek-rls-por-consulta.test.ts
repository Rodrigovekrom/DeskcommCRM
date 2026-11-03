import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/** ia.vek v1.9.14 (0602): as regras dizem o mesmo, sem função por linha na leitura. */
describe("0602 — RLS de tarefas, atividades e notas por consulta", () => {
  beforeAll(() => seedGov());

  const qual = (tabela: string, cmd: string) =>
    sql(`select coalesce(string_agg(qual, ' '), '') from pg_policies where schemaname='public' and tablename='${tabela}' and cmd in ('${cmd}','ALL');`);

  it("a leitura de tarefas não tem regra 'para tudo' nem função por linha", () => {
    expect(lastLine(sql(`select count(*) from pg_policies where schemaname='public' and tablename='crm_tasks' and cmd='ALL';`))).toBe("0");
    expect(qual("crm_tasks", "SELECT")).not.toMatch(/fn_role_at_least\(organization_id/);
    expect(qual("crm_lead_activities", "SELECT")).not.toContain("fn_can_view_lead");
    expect(qual("iavek_notas_de_atendimento", "SELECT")).not.toMatch(/fn_role_at_least\(organization_id/);
  });

  it("agente escreve tarefa; outra organização, não", () => {
    const como = (s: string) =>
      sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false); ${s}`);
    expect(lastLine(como(`with i as (insert into public.crm_tasks (organization_id, title, status, due_date)
      values ('${GOV_ORG}', 'tarefa 0602', 'pending', now()) returning 1) select count(*) from i;`))).toBe("1");
    expect(() =>
      como(`insert into public.crm_tasks (organization_id, title, status, due_date)
        values ('00000000-0000-4000-8000-0000000000ff', 'x', 'pending', now());`),
    ).toThrow(/row-level security/);
  });

  it("0603: auditoria, tokens e convites sem regra 'para tudo' nem função por linha", () => {
    for (const t of ["api_tokens", "team_invites"]) {
      expect(lastLine(sql(`select count(*) from pg_policies where schemaname='public' and tablename='${t}' and cmd='ALL';`))).toBe("0");
    }
    for (const t of ["api_audit_log", "api_tokens", "team_invites"]) {
      expect(qual(t, "SELECT")).not.toMatch(/fn_role_at_least\(organization_id/);
    }
  });

  it("a função de conjunto não fica exposta a anônimo", () => {
    expect(lastLine(sql(`select has_function_privilege('anon','public.fn_iavek_orgs_com_papel(text)','execute');`))).toBe("f");
  });

  it("a reserva da avaliação é só do servidor", () => {
    expect(lastLine(sql(`select has_table_privilege('authenticated','public.iavek_notas_reservas','select');`))).toBe("f");
    sql(`insert into public.iavek_notas_reservas (event_id, organization_id) values ('eeeeeeee-0602-4000-8000-000000000001', '${GOV_ORG}') on conflict do nothing;`);
    expect(() =>
      sql(`insert into public.iavek_notas_reservas (event_id, organization_id) values ('eeeeeeee-0602-4000-8000-000000000001', '${GOV_ORG}');`),
    ).toThrow(/duplicate key/);
  });
});
