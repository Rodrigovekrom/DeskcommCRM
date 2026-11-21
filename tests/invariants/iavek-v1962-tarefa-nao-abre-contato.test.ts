/**
 * ia.vek v1.9.62 (0649, CRM-497 4A; Lupa 1718, Maestro 193121): o vendedor não ganha acesso a contato pela tarefa.
 * RECUSADOS (PT403 tarefa_fora_do_alcance), na sessão do VENDEDOR: criar tarefa aberta de um contato que ele não
 * atende; reabrir a tarefa cancelada (a passagem); trocar o contato de uma tarefa dele para outro; reabrir a 'done'
 * antiga, mesmo depois de TOCAR o título (Lupa 202249: sem janela); dar a OUTRO vendedor o contato do lead dele.
 * PASSAM: o contato do lead dele; a gerência delegando; a 2ª tarefa do contato já delegado (é o que o registro de
 * ligação faz: cria a próxima com a atual aberta); a SDR; o servidor.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ORG, GOV_PIPELINE, GOV_STAGE, lastLine, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const N = "eeeeeeee-0649-4000-8000-000000000";
const C_LIVRE = `${N}001`;
const C_DO_LEAD = `${N}002`;
const C_DELEGADO = `${N}003`;
const C_JANELA = `${N}004`;
const LEAD_DO_A = `${N}011`;
const T_CANCELADA = `${N}021`;
const T_DO_LEAD = `${N}022`;
const T_DONE_VELHA = `${N}023`;
const T_DONE_NOVA = `${N}024`;

const como = (u: string, q: string): string => {
  try {
    return lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false); ${q}`));
  } catch (e) {
    return motivoDoErro(e);
  }
};
const funcao = (u: string, f: string) =>
  sql(`update public.user_organizations set interface_settings=coalesce(interface_settings,'{}'::jsonb)||'{"funcao":"${f}"}'::jsonb where organization_id='${GOV_ORG}' and user_id='${u}';`);
const criar = (u: string, contato: string, quem = u) =>
  como(u, `insert into public.crm_tasks (organization_id, title, contact_id, assigned_to, due_date, status)
             values ('${GOV_ORG}', 'T 0649', '${contato}', '${quem}', now() + interval '1 day', 'pending') returning 'CRIOU';`);

beforeAll(() => {
  seedGov();
  funcao(GOV_AGENT_A, "vendedor");
  funcao(GOV_AGENT_B, "sdr");
  sql(`
    insert into public.contacts (id, organization_id, name, phone_number) values
      ('${C_LIVRE}', '${GOV_ORG}', 'Livre 0649', '+5511966660649'),
      ('${C_DO_LEAD}', '${GOV_ORG}', 'Do lead 0649', '+5511966660650'),
      ('${C_DELEGADO}', '${GOV_ORG}', 'Delegado 0649', '+5511966660651'),
      ('${C_JANELA}', '${GOV_ORG}', 'Janela 0649', '+5511966660652')
      on conflict (id) do nothing;
    update public.conversations set assigned_to_user_id=null, assignee_kind=null where contact_id in ('${C_LIVRE}','${C_DO_LEAD}','${C_DELEGADO}','${C_JANELA}');
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, owner_user_id, owner_kind)
      values ('${LEAD_DO_A}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Lead do A 0649', '${C_DO_LEAD}', '${GOV_AGENT_A}', 'user') on conflict (id) do nothing;
    insert into public.crm_tasks (id, organization_id, title, contact_id, assigned_to, due_date, status) values
      ('${T_CANCELADA}', '${GOV_ORG}', 'Cancelada na passagem', '${C_LIVRE}', '${GOV_AGENT_A}', now(), 'cancelled'),
      ('${T_DO_LEAD}', '${GOV_ORG}', 'Do lead', '${C_DO_LEAD}', '${GOV_AGENT_A}', now() + interval '1 day', 'pending'),
      ('${T_DONE_VELHA}', '${GOV_ORG}', 'Feita há tempo', '${C_LIVRE}', '${GOV_AGENT_A}', now(), 'done'),
      ('${T_DONE_NOVA}', '${GOV_ORG}', 'Feita agora', '${C_JANELA}', '${GOV_AGENT_A}', now(), 'done')
      on conflict (id) do nothing;
    alter table public.crm_tasks disable trigger trg_crm_tasks_updated_at;
    update public.crm_tasks set updated_at = now() - interval '1 hour' where id = '${T_DONE_VELHA}';
    alter table public.crm_tasks enable trigger trg_crm_tasks_updated_at;
  `);
});

describe("0649: RECUSADO na sessão do vendedor", () => {
  it("criar tarefa aberta de um contato que ele não atende", () => {
    expect(criar(GOV_AGENT_A, C_LIVRE)).toMatch(/tarefa_fora_do_alcance/);
    expect(lastLine(sql(`select count(*) from public.crm_tasks where contact_id='${C_LIVRE}' and status='pending';`))).toBe("0");
  });

  it("reabrir a tarefa cancelada (a passagem)", () => {
    expect(como(GOV_AGENT_A, `update public.crm_tasks set status='pending' where id='${T_CANCELADA}';`)).toMatch(/tarefa_fora_do_alcance/);
    expect(lastLine(sql(`select status from public.crm_tasks where id='${T_CANCELADA}';`))).toBe("cancelled");
  });

  it("trocar o contato de uma tarefa aberta dele para um contato que ele não atende", () => {
    expect(como(GOV_AGENT_A, `update public.crm_tasks set contact_id='${C_LIVRE}' where id='${T_DO_LEAD}';`)).toMatch(/tarefa_fora_do_alcance/);
    expect(lastLine(sql(`select contact_id from public.crm_tasks where id='${T_DO_LEAD}';`))).toBe(C_DO_LEAD);
  });

  it("reabrir a 'done' antiga, mesmo TOCANDO o título antes (o updated_at recente não abre nada)", () => {
    expect(como(GOV_AGENT_A, `update public.crm_tasks set title='Tocada' where id='${T_DONE_VELHA}';`)).toMatch(/UPDATE 1/);
    expect(como(GOV_AGENT_A, `update public.crm_tasks set status='pending' where id='${T_DONE_VELHA}';`)).toMatch(/tarefa_fora_do_alcance/);
    expect(como(GOV_AGENT_A, `update public.crm_tasks set status='pending' where id='${T_DONE_NOVA}';`)).toMatch(/tarefa_fora_do_alcance/);
  });

  it("quem GANHA o acesso é o assigned_to: o vendedor A não dá a outro vendedor (B) o contato do lead dele", () => {
    funcao(GOV_AGENT_B, "vendedor");
    try {
      expect(criar(GOV_AGENT_A, C_DO_LEAD, GOV_AGENT_B)).toMatch(/tarefa_fora_do_alcance/);
      expect(como(GOV_AGENT_A, `update public.crm_tasks set assigned_to='${GOV_AGENT_B}' where id='${T_DO_LEAD}';`)).toMatch(/tarefa_fora_do_alcance/);
    } finally {
      funcao(GOV_AGENT_B, "sdr");
    }
  });
});

describe("0649: PASSA", () => {
  it("o contato do lead dele", () => {
    expect(criar(GOV_AGENT_A, C_DO_LEAD)).toMatch(/CRIOU|INSERT 0 1/);
  });

  it("editar a tarefa aberta dele sem mudar o contato", () => {
    expect(como(GOV_AGENT_A, `update public.crm_tasks set title='Do lead (editada)' where id='${T_DO_LEAD}';`)).toMatch(/UPDATE 1/);
  });

  it("a gerência delega ao vendedor uma tarefa de contato que ele não atende; depois ele cria a 2ª do mesmo contato", () => {
    expect(criar(GOV_MANAGER, C_DELEGADO, GOV_AGENT_A)).toMatch(/CRIOU|INSERT 0 1/);
    expect(criar(GOV_AGENT_A, C_DELEGADO)).toMatch(/CRIOU|INSERT 0 1/);
  });

  it("a SDR não está restrita", () => {
    expect(criar(GOV_AGENT_B, C_LIVRE)).toMatch(/CRIOU|INSERT 0 1/);
  });

  it("o servidor (sem sessão) não é tocado", () => {
    expect(
      lastLine(
        sql(`insert into public.crm_tasks (organization_id, title, contact_id, assigned_to, due_date, status)
             values ('${GOV_ORG}', 'Servidor 0649', '${C_LIVRE}', '${GOV_AGENT_A}', now() + interval '1 day', 'pending') returning 'CRIOU';`),
      ),
    ).toMatch(/CRIOU|INSERT 0 1/);
  });

  it("o registro de ligação: a próxima nasce com a atual AINDA aberta (outra tarefa aberta dele), e então a atual fecha", () => {
    // a atual: delegada pela gerência (o vendedor só alcança o contato por ela)
    expect(criar(GOV_MANAGER, C_JANELA, GOV_AGENT_A)).toMatch(/CRIOU|INSERT 0 1/);
    expect(criar(GOV_AGENT_A, C_JANELA)).toMatch(/CRIOU|INSERT 0 1/);
  });
});
