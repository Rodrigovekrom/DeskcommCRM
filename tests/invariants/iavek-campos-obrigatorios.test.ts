import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_CONTACT_1,
  GOV_CONV_UNASSIGNED,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_STAGE,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * ia.vek v1.8.2 (migration 0590) — campos obrigatórios.
 * Com o interruptor ligado, uma PESSOA não move o lead para etapa de compromisso
 * sem os 7 campos, e o banco diz o que falta. Desligado, ou movido pelo serviço
 * (IA, automação), nada trava. Mover para etapa que não é de compromisso nunca trava.
 */
const LEAD = "ab1e0000-6666-4000-8000-000000000001";
const AGENDAMENTO = "ab1e0000-5555-4000-8000-000000000001";
const NAO_RESPONDE = "ab1e0000-5555-4000-8000-000000000002";

const interruptor = (ativo: boolean) =>
  sql(`update public.organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{iavek}', coalesce(settings->'iavek','{}'::jsonb) || jsonb_build_object('campos_obrigatorios', jsonb_build_object('ativo', ${ativo}))) where id = '${GOV_ORG}';`);
const etapa = () => lastLine(sql(`select stage_id from public.crm_leads where id = '${LEAD}';`));
const voltar = () => sql(`update public.crm_leads set stage_id = '${GOV_STAGE}' where id = '${LEAD}';`);
const faltam = () => lastLine(sql(`select array_to_string(faltam, '|') from public.fn_iavek_campos_que_faltam(array['${LEAD}'::uuid]);`));

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${AGENDAMENTO}', '${GOV_ORG}', '${GOV_PIPELINE}', 'Agendamento', 'agendado-video', 5000),
             ('${NAO_RESPONDE}', '${GOV_ORG}', '${GOV_PIPELINE}', 'Não responde', 'nao-responde', 4000)
      on conflict (id) do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, owner_user_id, owner_kind)
      values ('${LEAD}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Obrigatórios', '${GOV_CONTACT_1}', '${GOV_AGENT_A}', 'user')
      on conflict (id) do nothing;
    update public.crm_leads set sdr_user_id = null, tags = '{}', custom_fields = '{}' where id = '${LEAD}';
    update public.contacts set tags = '{}' where id = '${GOV_CONTACT_1}';
    delete from public.conversation_notes where conversation_id in (select id from public.conversations where contact_id = '${GOV_CONTACT_1}');
    delete from public.lead_notes where contact_id = '${GOV_CONTACT_1}';
  `);
  interruptor(true);
});

describe("campos obrigatórios ao mover", () => {
  it("o banco diz o que falta, na ordem da tela (fase e vendedor já preenchidos)", () => {
    expect(faltam()).toBe("Contexto completo|Tags de acompanhamento|Guardião responsável|Carro de interesse|Parcela desejável");
  });

  it("ligado: a pessoa NÃO move para Agendamento sem os campos — e a recusa diz o que falta", () => {
    expect(() =>
      writeCountAs(GOV_AGENT_A, `update public.crm_leads set stage_id = '${AGENDAMENTO}' where id = '${LEAD}'`),
    ).toThrow(/Faltam campos obrigatórios: Contexto completo, Tags de acompanhamento/);
    expect(etapa()).toBe(GOV_STAGE);
  });

  it("mover para etapa que não é de compromisso (Não responde) não trava", () => {
    expect(writeCountAs(GOV_AGENT_A, `update public.crm_leads set stage_id = '${NAO_RESPONDE}' where id = '${LEAD}'`)).toBe(1);
    voltar();
  });

  it("o serviço (IA, automação, sem sessão) move mesmo incompleto", () => {
    sql(`update public.crm_leads set stage_id = '${AGENDAMENTO}' where id = '${LEAD}';`);
    expect(etapa()).toBe(AGENDAMENTO);
    voltar();
  });

  it("com os 7 campos, a pessoa move", () => {
    sql(`
      update public.crm_leads set sdr_user_id = '${GOV_AGENT_A}', tags = array['quente'],
        custom_fields = '{"carro_interesse":"Onix 2022","parcela_desejavel":1500}'::jsonb where id = '${LEAD}';
      insert into public.conversation_notes (organization_id, conversation_id, body)
        select '${GOV_ORG}', id, 'cliente quer financiar' from public.conversations where id = '${GOV_CONV_UNASSIGNED}' and contact_id = '${GOV_CONTACT_1}';
      insert into public.lead_notes (organization_id, contact_id, headline, body) values ('${GOV_ORG}', '${GOV_CONTACT_1}', 'Resumo', 'Quer Onix, parcela até 1500');
    `);
    expect(faltam()).toBe("");
    expect(writeCountAs(GOV_AGENT_A, `update public.crm_leads set stage_id = '${AGENDAMENTO}' where id = '${LEAD}'`)).toBe(1);
    voltar();
  });

  it("desligado (padrão): nada trava", () => {
    sql(`update public.crm_leads set custom_fields = '{}' where id = '${LEAD}';`);
    interruptor(false);
    expect(writeCountAs(GOV_AGENT_A, `update public.crm_leads set stage_id = '${AGENDAMENTO}' where id = '${LEAD}'`)).toBe(1);
    voltar();
  });

  it("quem é de outra organização não pergunta o que falta nos nossos leads", () => {
    const fora = "ab1e0000-1111-4000-8000-000000000009";
    sql(`insert into auth.users (id, email) values ('${fora}', 'obrig-fora@invariant.test') on conflict (id) do nothing;`);
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${fora}"}', false);
      select count(*) from public.fn_iavek_campos_que_faltam(array['${LEAD}'::uuid]);
    `);
    expect(lastLine(out)).toBe("0");
  });
});
