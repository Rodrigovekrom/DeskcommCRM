import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_CONTACT_1, GOV_CONTACT_2, GOV_MANAGER, GOV_ORG, GOV_PIPELINE, GOV_STAGE, lastLine, seedGov, sql } from "./gov-helpers";

/** ia.vek v1.9.19.1 (0607) — o vendedor só com os contatos dele; as demais funções e o serviço não mudam. */
const N = "eeeeeeee-0607-4000-8000-000000000";
const LEAD = `${N}001`;
const SOLTO = `${N}002`;

const como = (u: string, q: string): string => {
  try {
    return lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false); ${q}`));
  } catch (e) {
    return String((e as { stderr?: unknown }).stderr ?? (e as Error).message);
  }
};
const funcao = (u: string, f: string) =>
  sql(`update public.user_organizations set interface_settings=coalesce(interface_settings,'{}'::jsonb)||'{"funcao":"${f}"}'::jsonb where organization_id='${GOV_ORG}' and user_id='${u}';`);
const vejo = (u: string, c: string) => como(u, `select count(*) from public.contacts where id='${c}';`);

describe("0607 — contatos por função", () => {
  beforeAll(() => {
    seedGov();
    funcao(GOV_AGENT_A, "vendedor");
    sql(`
      update public.conversations set assigned_to_user_id=null, assignee_kind=null where contact_id in ('${GOV_CONTACT_1}','${GOV_CONTACT_2}');
      delete from public.crm_leads where contact_id in ('${GOV_CONTACT_1}','${GOV_CONTACT_2}') and id<>'${LEAD}';
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id, owner_user_id, owner_kind)
        values ('${LEAD}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Lead 0607', 1, '${GOV_CONTACT_1}', '${GOV_AGENT_A}', 'user') on conflict (id) do nothing;
      insert into public.contacts (id, organization_id, name, phone_number) values ('${SOLTO}', '${GOV_ORG}', 'Solto 0607', '+5511966660607') on conflict (id) do nothing;
    `);
  });

  it("vendedor vê o contato do lead dele e não o dos outros", () => {
    expect(vejo(GOV_AGENT_A, GOV_CONTACT_1)).toBe("1");
    expect(vejo(GOV_AGENT_A, SOLTO)).toBe("0");
  });

  it("vendedor não altera nem apaga o que não é dele, e não apaga o dele", () => {
    expect(como(GOV_AGENT_A, `update public.contacts set name='Invadiu' where id='${SOLTO}';`)).toMatch(/UPDATE 0/);
    expect(lastLine(sql(`select name from public.contacts where id='${SOLTO}';`))).toBe("Solto 0607");
    expect(como(GOV_AGENT_A, `delete from public.contacts where id='${SOLTO}';`)).toMatch(/DELETE 0/);
    expect(como(GOV_AGENT_A, `delete from public.contacts where id='${GOV_CONTACT_1}';`)).toMatch(/vendedor_nao_apaga_contato/);
  });

  it("vendedor cria contato e segue vendo o que criou", () => {
    const r = como(GOV_AGENT_A, `insert into public.contacts (organization_id, name, phone_number, created_by_user_id) values ('${GOV_ORG}', 'Novo do vendedor', '+5511966660608', '${GOV_AGENT_A}') returning name;`);
    expect(r).toMatch(/Novo do vendedor|INSERT 0 1/);
  });

  it("lead passado a ele traz o contato; tirado, leva", () => {
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_B}' where id='${LEAD}';`);
    expect(vejo(GOV_AGENT_A, GOV_CONTACT_1)).toBe("0");
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}' where id='${LEAD}';`);
    expect(vejo(GOV_AGENT_A, GOV_CONTACT_1)).toBe("1");
  });

  it("as demais funções não mudam", () => {
    expect(vejo(GOV_MANAGER, SOLTO)).toBe("1");
    funcao(GOV_AGENT_B, "sdr");
    expect(vejo(GOV_AGENT_B, SOLTO)).toBe("1");
    expect(como(GOV_MANAGER, `update public.contacts set name='Solto 0607' where id='${SOLTO}';`)).toMatch(/UPDATE 1/);
  });

  it("a entrada sem sessão segue criando contato", () => {
    sql(`insert into public.contacts (organization_id, name, phone_number) values ('${GOV_ORG}', 'Entrada', '+5511966660609') on conflict do nothing;`);
    expect(lastLine(sql(`select count(*) from public.contacts where phone_number='+5511966660609';`))).toBe("1");
  });
});
