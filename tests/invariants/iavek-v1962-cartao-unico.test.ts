/**
 * ia.vek v1.9.62 (0647, CRM-497 "um cartão só" e D4 do Rodrigo): as 5 coisas do banco, provadas por comportamento.
 *  1. (D4 4A) a tarefa só dá acesso ao contato enquanto ABERTA (fn_iavek_contatos_do_vendedor);
 *  2. fn_iavek_tarefas_da_passagem: só do servidor; fecha as automáticas e, com o 2º motivo, as de pessoa; a 'done'
 *     fica; cada uma ganha a linha 'task_cancelled'; nenhuma é reatribuída;
 *  3. o sinal iavek.mudanca_administrativa (SET LOCAL) cala o evento e o aviso; sem ele, os dois saem;
 *  4. a troca de FUNIL não avisa 'guardiao_etapa'; a troca de etapa no mesmo funil avisa (como antes);
 *  5. a invariante: a etapa de todo lead pertence ao funil dele.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ORG, GOV_PIPELINE, GOV_STAGE, lastLine, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const N = "eeeeeeee-0647-4000-8000-000000000";
const CONTATO = `${N}001`;
const LEAD = `${N}002`;
const FUNIL_2 = `${N}003`;
const ETAPA_2 = `${N}004`;
const ETAPA_1B = `${N}005`;
const T_AUTO = `${N}011`;
const T_PESSOA = `${N}012`;
const T_FEITA = `${N}013`;
const T_ACESSO = `${N}014`;
const LEAD_DO_SINAL = `${N}021`;
const LEAD_DO_GUARDIAO = `${N}031`;

const como = (u: string, q: string): string => {
  try {
    return lastLine(sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${u}"}', false); ${q}`));
  } catch (e) {
    return motivoDoErro(e);
  }
};
const valor = (q: string) => lastLine(sql(q));
const funcao = (u: string, f: string) =>
  sql(`update public.user_organizations set interface_settings=coalesce(interface_settings,'{}'::jsonb)||'{"funcao":"${f}"}'::jsonb where organization_id='${GOV_ORG}' and user_id='${u}';`);

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, name, phone_number) values ('${CONTATO}', '${GOV_ORG}', 'Contato 0647', '+5511966660647') on conflict (id) do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL_2}', '${GOV_ORG}', 'Follow-up 0647', 'fu-0647') on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${ETAPA_2}', '${GOV_ORG}', '${FUNIL_2}', 'Fase 1', 'fase-1-0647', 1000),
      ('${ETAPA_1B}', '${GOV_ORG}', '${GOV_PIPELINE}', 'Outra etapa', 'outra-0647', 2000)
      on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
      values ('${LEAD}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Lead 0647', null) on conflict (id) do nothing;
    insert into public.crm_tasks (id, organization_id, title, lead_id, assigned_to, due_date, status, source_kind) values
      ('${T_AUTO}', '${GOV_ORG}', 'L2', '${LEAD}', '${GOV_AGENT_B}', now() + interval '1 day', 'pending', 'ligacao:L2'),
      ('${T_PESSOA}', '${GOV_ORG}', 'De pessoa', '${LEAD}', '${GOV_AGENT_B}', now() + interval '1 day', 'pending', null),
      ('${T_FEITA}', '${GOV_ORG}', 'Feita', '${LEAD}', '${GOV_AGENT_B}', now() - interval '1 day', 'done', null)
      on conflict (id) do nothing;
  `);
});

describe("0647 (D4 4A): a tarefa só dá acesso ao contato enquanto aberta", () => {
  beforeAll(() => {
    funcao(GOV_AGENT_A, "vendedor");
    sql(`update public.conversations set assigned_to_user_id=null, assignee_kind=null where contact_id='${CONTATO}';
         insert into public.crm_tasks (id, organization_id, title, contact_id, assigned_to, due_date, status)
           values ('${T_ACESSO}', '${GOV_ORG}', 'Acesso', '${CONTATO}', '${GOV_AGENT_A}', now() + interval '1 day', 'pending')
           on conflict (id) do nothing;`);
  });
  const vejo = () => como(GOV_AGENT_A, `select count(*) from public.contacts where id='${CONTATO}';`);

  it("com a tarefa aberta (pending, in_progress), o vendedor vê o contato", () => {
    sql(`update public.crm_tasks set status='pending' where id='${T_ACESSO}';`);
    expect(vejo()).toBe("1");
    sql(`update public.crm_tasks set status='in_progress' where id='${T_ACESSO}';`);
    expect(vejo()).toBe("1");
  });

  it("feita ou cancelada, não vê mais (era o vazamento)", () => {
    sql(`update public.crm_tasks set status='done' where id='${T_ACESSO}';`);
    expect(vejo()).toBe("0");
    sql(`update public.crm_tasks set status='cancelled' where id='${T_ACESSO}';`);
    expect(vejo()).toBe("0");
  });

  it("controle: a gerência segue vendo", () => {
    expect(como(GOV_MANAGER, `select count(*) from public.contacts where id='${CONTATO}';`)).toBe("1");
  });
});

describe("0647: fn_iavek_tarefas_da_passagem", () => {
  it("é só do servidor: o authenticated não executa", () => {
    expect(como(GOV_MANAGER, `select public.fn_iavek_tarefas_da_passagem('${GOV_ORG}', '${LEAD}', 'x', 'y');`)).toMatch(/permission denied/);
    expect(valor(`select count(*) from public.crm_tasks where lead_id='${LEAD}' and status='cancelled';`)).toBe("0");
  });

  it("sem o 2º motivo, fecha SÓ as automáticas", () => {
    const r = valor(`set role service_role; select public.fn_iavek_tarefas_da_passagem('${GOV_ORG}', '${LEAD}', 'passou_o_lead', null)::text;`);
    expect(JSON.parse(r)).toEqual({ automaticas: 1, de_pessoa: 0 });
    expect(valor(`select status || '/' || cancelada_motivo from public.crm_tasks where id='${T_AUTO}';`)).toBe("cancelled/passou_o_lead");
    expect(valor(`select status from public.crm_tasks where id='${T_PESSOA}';`)).toBe("pending");
  });

  it("com o 2º motivo, fecha as de pessoa; a 'done' fica; ninguém é reatribuído; cada uma tem a linha task_cancelled", () => {
    const r = valor(`set role service_role; select public.fn_iavek_tarefas_da_passagem('${GOV_ORG}', '${LEAD}', 'passou_ao_followup', 'passagem_sem_revisao')::text;`);
    expect(JSON.parse(r)).toEqual({ automaticas: 0, de_pessoa: 1 });
    expect(valor(`select status || '/' || cancelada_motivo || '/' || assigned_to from public.crm_tasks where id='${T_PESSOA}';`)).toBe(
      `cancelled/passagem_sem_revisao/${GOV_AGENT_B}`,
    );
    expect(valor(`select status from public.crm_tasks where id='${T_FEITA}';`)).toBe("done");
    // (Lupa 201732) a automática pela fn_iavek_cancela_ligacoes (0640, a linha dela); a de pessoa pela 0647
    expect(
      valor(`select count(*) from public.crm_lead_activities where lead_id='${LEAD}' and type='task_cancelled' and metadata->>'origem'='gatilho_0640';`),
    ).toBe("1");
    expect(
      valor(`select count(*) from public.crm_lead_activities where lead_id='${LEAD}' and type='task_cancelled' and metadata->>'origem'='passagem_0647';`),
    ).toBe("1");
  });

  it("sem o motivo das automáticas, recusa", () => {
    let erro = "";
    try {
      sql(`set role service_role; select public.fn_iavek_tarefas_da_passagem('${GOV_ORG}', '${LEAD}', '', null);`);
    } catch (e) {
      erro = motivoDoErro(e);
    }
    expect(erro).toMatch(/obrigatório/);
  });
});

describe("0647: o sinal administrativo", () => {
  beforeAll(() => {
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id, owner_kind)
           values ('${LEAD_DO_SINAL}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Sinal 0647', '${GOV_AGENT_A}', 'user') on conflict (id) do nothing;`);
  });
  const eventos = () => valor(`select count(*) from public.event_log where event_type='lead.assigned' and payload->>'lead_id'='${LEAD_DO_SINAL}';`);
  const avisos = () => valor(`select count(*) from public.notificacoes where lead_id='${LEAD_DO_SINAL}' and tipo='lead_passado';`);

  it("COM o sinal (SET LOCAL na transação), a troca de dono não emite evento nem aviso", () => {
    sql(`begin; set local iavek.mudanca_administrativa = 'sim';
         update public.crm_leads set owner_user_id='${GOV_AGENT_B}' where id='${LEAD_DO_SINAL}'; commit;`);
    expect(valor(`select owner_user_id from public.crm_leads where id='${LEAD_DO_SINAL}';`)).toBe(GOV_AGENT_B);
    expect(eventos()).toBe("0");
    expect(avisos()).toBe("0");
  });

  it("SEM o sinal, os dois saem (controle)", () => {
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}' where id='${LEAD_DO_SINAL}';`);
    expect(eventos()).toBe("1");
    expect(avisos()).toBe("1");
  });

  it("o sinal é LOCAL: depois do commit, não vale mais", () => {
    sql(`begin; set local iavek.mudanca_administrativa = 'sim'; commit;
         update public.crm_leads set owner_user_id='${GOV_AGENT_B}' where id='${LEAD_DO_SINAL}';`);
    expect(eventos()).toBe("2");
  });
});

describe("0647: a troca de FUNIL não avisa 'guardiao_etapa'", () => {
  beforeAll(() => {
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, sdr_user_id)
           values ('${LEAD_DO_GUARDIAO}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Guardião 0647', '${GOV_AGENT_B}') on conflict (id) do nothing;`);
  });
  const etapa = () => valor(`select count(*) from public.notificacoes where lead_id='${LEAD_DO_GUARDIAO}' and tipo='guardiao_etapa';`);

  it("a etapa muda no MESMO funil: avisa o guardião (como antes)", () => {
    sql(`update public.crm_leads set stage_id='${ETAPA_1B}' where id='${LEAD_DO_GUARDIAO}';`);
    expect(etapa()).toBe("1");
  });

  it("o lead muda de FUNIL (a passagem da esteira): não avisa", () => {
    sql(`update public.crm_leads set pipeline_id='${FUNIL_2}', stage_id='${ETAPA_2}', esteira_passou_em=now() where id='${LEAD_DO_GUARDIAO}';`);
    expect(valor(`select pipeline_id from public.crm_leads where id='${LEAD_DO_GUARDIAO}';`)).toBe(FUNIL_2);
    expect(etapa()).toBe("1");
  });
});

describe("a invariante do cartão único: a etapa de todo lead pertence ao funil dele", () => {
  it("0 leads com a etapa de outro funil", () => {
    expect(
      valor(`select count(*) from public.crm_leads l join public.crm_stages s on s.id = l.stage_id where s.pipeline_id is distinct from l.pipeline_id;`),
    ).toBe("0");
  });
});
