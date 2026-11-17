/**
 * ia.vek CRM-532 (Lupa 194615, ponto 2): o botão "Ligar" segue a visão.
 *
 * O número que o botão usa vem SEMPRE do que a tela já leu pela RLS de `contacts`, com o cliente da sessão: o embed
 * `contacts` da conversa, o quadro do negócio (`withMarcadoresDoContato`, no board) e o embed `contato:contacts` da lista
 * de tarefas. Sem a linha do contato, sem telefone; sem telefone, sem botão (hrefDeLigar → null).
 *
 * Este teste prova, no banco de verdade, o caso que importa: a SDR que a 0641 esconde (o contato foi ao Follow-up e não é
 * dela) NÃO lê o telefone. E prova que é a 0641 que esconde, com o CONTROLE: antes de ligar o Follow-up na org, ela lê.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, countAs, seedGov, sql } from "./gov-helpers";

const USER_SDR = "c5320000-1111-4000-8000-000000000001";
const PIPE_FU = "c5320000-5555-4000-8000-000000000001";
const STAGE_FU = "c5320000-5555-4000-8000-000000000002";
const CONTATO = "c5320000-3333-4000-8000-000000000001";
const LEAD = "c5320000-6666-4000-8000-000000000001";

const lerTelefone = (user: string) =>
  countAs(user, `select count(*) from public.contacts where id = '${CONTATO}' and phone_number is not null;`);

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${USER_SDR}', 'crm532-sdr@invariant.test') on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings)
      values ('${USER_SDR}', '${GOV_ORG}', 'agent', now(), '{"preset":"completa","funcao":"sdr"}'::jsonb) on conflict do nothing;
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${PIPE_FU}', '${GOV_ORG}', 'Follow-up CRM-532', 'fu-crm532') on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${STAGE_FU}', '${GOV_ORG}', '${PIPE_FU}', 'Fase 1', 'fase-1', 1000) on conflict do nothing;
    insert into public.contacts (id, organization_id, name, phone_number)
      values ('${CONTATO}', '${GOV_ORG}', 'Contato no Follow-up CRM-532', '+5532984793302') on conflict do nothing;
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
      values ('${LEAD}', '${GOV_ORG}', '${PIPE_FU}', '${STAGE_FU}', 'Lead no Follow-up', '${CONTATO}') on conflict do nothing;
  `);
});

afterAll(() => {
  sql(`
    delete from public.crm_leads where id = '${LEAD}';
    delete from public.contacts where id = '${CONTATO}';
    delete from public.user_organizations where user_id = '${USER_SDR}';
  `);
});

describe("CRM-532: o telefone do botão Ligar segue a RLS de contacts", () => {
  it("CONTROLE: sem o Follow-up ligado na org, a SDR lê o telefone", () => {
    expect(lerTelefone(USER_SDR)).toBe(1);
  });

  it("a SDR ESCONDIDA pela 0641 (o contato foi ao Follow-up e não é dela) NÃO lê o telefone: sem número, sem botão", () => {
    sql(`
      update public.organizations
         set settings = coalesce(settings, '{}'::jsonb)
                        || jsonb_build_object('esteira', coalesce(settings->'esteira', '{}'::jsonb)
                             || jsonb_build_object('followup', jsonb_build_object('pipeline_id', '${PIPE_FU}')))
       where id = '${GOV_ORG}';
    `);
    expect(lerTelefone(USER_SDR)).toBe(0);
  });
});
