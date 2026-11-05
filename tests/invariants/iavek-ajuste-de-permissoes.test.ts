import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_CONV_AGENT_B, GOV_MANAGER, GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/** ia.vek v1.9.19 (0606) — a troca de responsável respeita o alcance; vendedor fora da coluna da IA. */
const N = "eeeeeeee-0616-4000-8000-000000000";
const FUNIL = `${N}002`;
const IA = `${N}003`;
const OUTRA = `${N}004`;
const LEAD = `${N}005`;

const comoPessoa = (u: string, q: string): string => {
  try {
    return lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false); ${q}`));
  } catch (e) {
    return String((e as { stderr?: unknown }).stderr ?? (e as Error).message);
  }
};
const dono = () => lastLine(sql(`select assigned_to_user_id from public.conversations where id='${GOV_CONV_AGENT_B}';`));
const funcao = (u: string, f: string) =>
  sql(`update public.user_organizations set interface_settings=coalesce(interface_settings,'{}'::jsonb)||'{"funcao":"${f}"}'::jsonb where organization_id='${GOV_ORG}' and user_id='${u}';`);

describe("0606 — ajuste de permissões", () => {
  beforeAll(() => {
    seedGov();
    funcao(GOV_AGENT_A, "vendedor");
    sql(`
      update public.conversations set assigned_to_user_id='${GOV_AGENT_B}', assignee_kind='user' where id='${GOV_CONV_AGENT_B}';
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${GOV_ORG}', 'Funil 0616', 'funil-0616') on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${IA}', '${GOV_ORG}', '${FUNIL}', 'IA Atendendo', 'ia-0616', 1), ('${OUTRA}', '${GOV_ORG}', '${FUNIL}', 'Outra', 'outra-0616', 2) on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, owner_user_id, owner_kind)
        values ('${LEAD}', '${GOV_ORG}', '${FUNIL}', '${OUTRA}', 'Lead 0616', 1, '${GOV_AGENT_A}', 'user') on conflict (id) do nothing;
    `);
  });

  it("vendedor não assume conversa de outro chamando a função direto", () => {
    const r = comoPessoa(GOV_AGENT_A, `select id from public.fn_conversation_assign('${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${GOV_AGENT_A}', 'transfer');`);
    expect(r).toMatch(/conversa_fora_do_alcance/);
    expect(dono()).toBe(GOV_AGENT_B);
  });

  it("vendedor não manda a conversa de outro para terceiro", () => {
    const r = comoPessoa(GOV_AGENT_A, `select id from public.fn_conversation_assign('${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${GOV_MANAGER}', 'transfer');`);
    expect(r).toMatch(/conversa_fora_do_alcance/);
    expect(dono()).toBe(GOV_AGENT_B);
  });

  it("gerente transfere; o serviço segue livre", () => {
    expect(comoPessoa(GOV_MANAGER, `select id from public.fn_conversation_assign('${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${GOV_AGENT_A}', 'transfer');`)).toBe(GOV_CONV_AGENT_B);
    expect(dono()).toBe(GOV_AGENT_A);
    sql(`update public.conversations set assigned_to_user_id='${GOV_AGENT_B}' where id='${GOV_CONV_AGENT_B}';`);
    expect(dono()).toBe(GOV_AGENT_B);
  });

  it("dono transfere a própria", () => {
    expect(comoPessoa(GOV_AGENT_B, `select id from public.fn_conversation_assign('${GOV_ORG}', '${GOV_CONV_AGENT_B}', '${GOV_MANAGER}', 'transfer');`)).toBe(GOV_CONV_AGENT_B);
  });

  it("vendedor não move para a coluna da IA; outra função, sim", () => {
    const m = `update public.crm_leads set stage_id='${IA}' where id='${LEAD}' returning 1;`;
    expect(comoPessoa(GOV_AGENT_A, m)).toMatch(/vendedor_fora_da_coluna_da_ia/);
    expect(lastLine(sql(`select stage_id from public.crm_leads where id='${LEAD}';`))).toBe(OUTRA);
    funcao(GOV_AGENT_A, "sdr");
    expect(comoPessoa(GOV_AGENT_A, m)).toMatch(/UPDATE 1|^1$/);
    expect(lastLine(sql(`select stage_id from public.crm_leads where id='${LEAD}';`))).toBe(IA);
    funcao(GOV_AGENT_A, "vendedor");
  });
});
