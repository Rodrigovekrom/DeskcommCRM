import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_CONTACT_1, GOV_MANAGER, GOV_ORG, GOV_SESSION, countAs, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.21 (0609) — Guardião Leads. Com `guardiao_ve_sem_dono = false` o guardião não
 * enxerga lead sem dono; a faixa é a única exceção, só para quem está em Suporte IA, e só ele a recebe.
 */
const N = "eeeeeeee-0609-4000-8000-000000000";
const FUNIL = `${N}002`;
const SUPORTE = `${N}003`;
const OUTRA = `${N}004`;
const NA_FAIXA = `${N}006`;
const FORA = `${N}007`;
const COM_DONO = `${N}008`;
const COM_CONVERSA = `${N}009`;
const CONTATO = `${N}010`;
const CONVERSA = `${N}011`;

const como = (u: string, q: string): string => {
  try {
    return lastLine(
      sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false); ${q}`),
    );
  } catch (e) {
    return String((e as Error).message + String((e as { stderr?: unknown }).stderr ?? ""));
  }
};
const naFaixa = (u: string) => countAs(u, `select count(*) from public.fn_iavek_faixa_de_ajuda('${GOV_ORG}');`);
const veSemDono = (u: string) =>
  countAs(u, `select count(*) from public.crm_leads where id in ('${NA_FAIXA}','${FORA}');`);

describe("0609 — faixa de pedidos de ajuda", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      update public.user_organizations set role='agent', interface_settings=coalesce(interface_settings,'{}'::jsonb) || '{"funcao":"sdr"}'::jsonb
        where organization_id='${GOV_ORG}' and user_id='${GOV_AGENT_A}';
      update public.user_organizations set role='agent', interface_settings=coalesce(interface_settings,'{}'::jsonb) || '{"funcao":"vendedor"}'::jsonb
        where organization_id='${GOV_ORG}' and user_id='${GOV_AGENT_B}';
      update public.organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{iavek}',
        coalesce(settings->'iavek','{}'::jsonb) || '{"guardiao_ve_sem_dono":"false"}'::jsonb) where id='${GOV_ORG}';
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${GOV_ORG}', 'Funil 0609', 'funil-0609') on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${SUPORTE}', '${GOV_ORG}', '${FUNIL}', 'Suporte IA', 'em-atendimento-ia', 1),
        ('${OUTRA}', '${GOV_ORG}', '${FUNIL}', 'IA Atendendo', 'novo', 2) on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id, owner_user_id, owner_kind) values
        ('${NA_FAIXA}', '${GOV_ORG}', '${FUNIL}', '${SUPORTE}', 'Na faixa', 1, null, null, null),
        ('${FORA}', '${GOV_ORG}', '${FUNIL}', '${OUTRA}', 'Fora da faixa', 2, null, null, null),
        ('${COM_DONO}', '${GOV_ORG}', '${FUNIL}', '${SUPORTE}', 'Com dono', 3, '${GOV_CONTACT_1}', '${GOV_AGENT_B}', 'user') on conflict (id) do nothing;
      insert into public.contacts (id, organization_id, name, phone_number) values ('${CONTATO}', '${GOV_ORG}', 'Cliente da faixa', '+5500066000609') on conflict (id) do nothing;
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values ('${CONVERSA}', '${GOV_ORG}', '${CONTATO}', '${GOV_SESSION}', 'open') on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id) values
        ('${COM_CONVERSA}', '${GOV_ORG}', '${FUNIL}', '${SUPORTE}', 'Com conversa', 4, '${CONTATO}') on conflict (id) do nothing;
    `);
  });

  it("guardião não enxerga lead sem dono; gerente enxerga", () => {
    expect(veSemDono(GOV_AGENT_A)).toBe(0);
    expect(veSemDono(GOV_AGENT_B)).toBe(0);
    expect(veSemDono(GOV_MANAGER)).toBe(2);
  });

  it("a faixa só chega ao guardião, e só com o sem dono em Suporte IA", () => {
    expect(naFaixa(GOV_AGENT_A)).toBe(2);
    expect(naFaixa(GOV_AGENT_B)).toBe(0);
    expect(naFaixa(GOV_MANAGER)).toBe(0);
  });

  it("quem não é guardião não assume; fora de Suporte IA, nem o guardião", () => {
    expect(como(GOV_AGENT_B, `select public.fn_iavek_assumir_da_faixa('${NA_FAIXA}');`)).toMatch(/faixa_so_guardiao/);
    expect(como(GOV_MANAGER, `select public.fn_iavek_assumir_da_faixa('${NA_FAIXA}');`)).toMatch(/faixa_so_guardiao/);
    expect(como(GOV_AGENT_A, `select public.fn_iavek_assumir_da_faixa('${FORA}');`)).toMatch(/faixa_ja_entregue/);
    expect(como(GOV_AGENT_A, `select public.fn_iavek_assumir_da_faixa('${COM_DONO}');`)).toMatch(/faixa_ja_entregue/);
  });

  it("o guardião assume uma vez: vira dono, some da faixa, e a segunda tentativa é recusada", () => {
    como(GOV_AGENT_A, `select public.fn_iavek_assumir_da_faixa('${NA_FAIXA}');`);
    expect(lastLine(sql(`select owner_user_id from public.crm_leads where id='${NA_FAIXA}'`))).toBe(GOV_AGENT_A);
    expect(naFaixa(GOV_AGENT_A)).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.crm_leads where id='${NA_FAIXA}';`)).toBe(1);
    expect(como(GOV_AGENT_A, `select public.fn_iavek_assumir_da_faixa('${NA_FAIXA}');`)).toMatch(/faixa_ja_entregue/);
  });

  it("com conversa, a conversa vai junto, mesmo com o recorte ligado", () => {
    expect(como(GOV_AGENT_A, `select public.fn_iavek_assumir_da_faixa('${COM_CONVERSA}');`)).toBe(CONVERSA);
    expect(lastLine(sql(`select assigned_to_user_id from public.conversations where id='${CONVERSA}'`))).toBe(GOV_AGENT_A);
    expect(lastLine(sql(`select owner_user_id from public.crm_leads where id='${COM_CONVERSA}'`))).toBe(GOV_AGENT_A);
    expect(naFaixa(GOV_AGENT_A)).toBe(0);
  });

  it("anon não chama as funções novas", () => {
    for (const f of ["fn_iavek_faixa_de_ajuda(uuid)", "fn_iavek_assumir_da_faixa(uuid)"]) {
      expect(lastLine(sql(`select has_function_privilege('anon', 'public.${f}', 'execute')`))).toBe("f");
    }
  });
});
