import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_CONV_UNASSIGNED,
  GOV_MANAGER,
  GOV_ORG,
  GOV_PIPELINE,
  GOV_STAGE,
  countAs,
  lastLine,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * ia.vek v1.8.4 (migration 0593) — nota do atendimento.
 *  · só gerente/admin leem as notas; o vendedor não lê nem escreve;
 *  · o mesmo evento não gera duas notas;
 *  · anonimizar o contato apaga os TEXTOS da nota (a nota fica);
 *  · o claude-haiku-5-5 tem preço (senão o custo seria zero e o teto não veria);
 *  · "Contexto do atendimento" (0597; era "Contexto completo") aceita a Descrição do lead com 20+ letras.
 */
const EVENTO = "ab1e0000-8888-4000-8000-000000000001";
const CONTATO_LGPD = "ab1e0000-8888-4000-8000-000000000002";
const CONV_LGPD = "ab1e0000-8888-4000-8000-000000000003";
const LEAD_DESC = "ab1e0000-8888-4000-8000-000000000004";
const ORG_B = "ab1e0000-8888-4000-8000-0000000000b0";
const ADMIN_B = "ab1e0000-8888-4000-8000-0000000000b1";

const nota = (conv: string, evento: string, contato: string | null = null) =>
  sql(`insert into public.iavek_notas_de_atendimento
         (organization_id, conversation_id, contact_id, vendedor_user_id, event_id, nota, pontos_fortes, pontos_a_melhorar, trecho, ate, modelo)
       values ('${GOV_ORG}', '${conv}', ${contato ? `'${contato}'` : "null"}, '${GOV_AGENT_A}', '${evento}', 7.5,
               array['respondeu rápido'], array['não ofereceu carro'], 'Cliente: quero o Onix', now(), 'claude-haiku-5-5')
       on conflict (organization_id, event_id) do nothing;`);

beforeAll(() => {
  seedGov();
  sql(`delete from public.iavek_notas_de_atendimento where organization_id = '${GOV_ORG}';`);
  nota(GOV_CONV_UNASSIGNED, EVENTO);
  sql(`
    insert into auth.users (id, email) values ('${ADMIN_B}', 'nota-admin-b@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG_B}', 'nota-inv-b', 'Nota B', 'Nota B') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${ADMIN_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
  `);
});

describe("nota do atendimento", () => {
  it("o gerente lê; o vendedor (agent) não lê", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.iavek_notas_de_atendimento where organization_id = '${GOV_ORG}';`)).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.iavek_notas_de_atendimento where organization_id = '${GOV_ORG}';`)).toBe(0);
  });

  it("o admin de OUTRA organização lê zero", () => {
    expect(countAs(ADMIN_B, `select count(*) from public.iavek_notas_de_atendimento;`)).toBe(0);
  });

  it("ninguém da sessão escreve nota (só o servidor)", () => {
    expect(() =>
      sql(`set role authenticated;
           select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
           insert into public.iavek_notas_de_atendimento (organization_id, conversation_id, event_id, nota, ate, modelo)
           values ('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', gen_random_uuid(), 10, now(), 'x');`),
    ).toThrow(/permission denied/);
  });

  it("o mesmo evento não gera duas notas", () => {
    nota(GOV_CONV_UNASSIGNED, EVENTO);
    expect(lastLine(sql(`select count(*) from public.iavek_notas_de_atendimento where event_id = '${EVENTO}';`))).toBe("1");
  });

  it("anonimizar o contato apaga os textos da nota dele, e a nota fica", () => {
    sql(`
      insert into public.contacts (id, organization_id, display_name, phone_number)
        values ('${CONTATO_LGPD}', '${GOV_ORG}', 'Cliente Nota', '+5515900000001') on conflict (id) do nothing;
      insert into public.conversations
        select (jsonb_populate_record(c, jsonb_build_object('id', '${CONV_LGPD}', 'contact_id', '${CONTATO_LGPD}'))).*
          from public.conversations c where c.id = '${GOV_CONV_UNASSIGNED}'
        on conflict (id) do nothing;
    `);
    nota(CONV_LGPD, "ab1e0000-8888-4000-8000-000000000005");
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${CONTATO_LGPD}';`);
    const r = lastLine(sql(`select nota || '|' || coalesce(trecho, '-') || '|' || cardinality(pontos_fortes) || '|' || cardinality(pontos_a_melhorar)
                              from public.iavek_notas_de_atendimento where conversation_id = '${CONV_LGPD}';`));
    expect(r).toBe("7.5|-|0|0");
  });

  it("o claude-haiku-5-5 tem preço no catálogo (10 e 50 centavos por milhão)", () => {
    expect(lastLine(sql(`select prompt_cents_per_million_tokens::int || '/' || completion_cents_per_million_tokens::int
                           from public.ai_pricing where model = 'claude-haiku-5-5' and superseded_at is null;`))).toBe("10/50");
  });

  it("o tipo de invocação novo é aceito", () => {
    expect(lastLine(sql(`select pg_get_constraintdef(oid) like '%iavek_nota_atendimento%' from pg_constraint where conname = 'ai_invocations_invocation_kind_check';`))).toBe("t");
  });

  it("'Contexto do atendimento' (0597; era 'Contexto completo') aceita a Descrição com 20+ letras (lead sem conversa)", () => {
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, description)
           values ('${LEAD_DESC}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Sem conversa', 'curto')
           on conflict (id) do update set description = 'curto';`);
    const faltam = () => lastLine(sql(`select array_to_string(faltam, '|') from public.fn_iavek_campos_que_faltam(array['${LEAD_DESC}'::uuid]);`));
    expect(faltam()).toContain("Contexto do atendimento");
    sql(`update public.crm_leads set description = 'Quer Onix 2022, financiar em 48x' where id = '${LEAD_DESC}';`);
    expect(faltam()).not.toContain("Contexto do atendimento");
  });
});
