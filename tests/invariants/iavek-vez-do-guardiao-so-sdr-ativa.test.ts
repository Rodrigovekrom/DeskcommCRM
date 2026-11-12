import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.49 (migration 0631, Maestro 170903): a vez do guardião só vai a quem é SDR ATIVA NA HORA, no aviso do grupo
 * (fn_iavek_aviso_de_ajuda, a 0623) e no lead sem guardião agendado (fn_iavek_guardiao_do_agendamento, a 0628). A lista do
 * rodízio é só a ORDEM: quem NÃO é SDR (a pessoa da lista que virou 'gerente') é pulado, quem saiu da loja é pulado, e com
 * nenhuma SDR ativa na lista (ou a lista vazia) vale a regra de antes (as 'sdr' ativas da loja).
 * Organização PRÓPRIA deste arquivo (a lista do rodízio é da organização).
 */
const N = "a0d49631-0000-4000-8000-0000000000";
const ORG = `${N}01`;
const SDR1 = "a0d49631-1111-4000-8000-000000000001";
const SDR2 = "a0d49631-1111-4000-8000-000000000002";
const GER = "a0d49631-1111-4000-8000-000000000003";
const SAIU = "a0d49631-1111-4000-8000-000000000004";
const FUNIL = `${N}02`;
const NOVO = `${N}03`;
const SUPORTE = `${N}04`;

function lista(participantes: string[]) {
  sql(`update public.organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{iavek}', jsonb_build_object('rodizio', jsonb_build_object('ativo', false, 'participantes', '${JSON.stringify(participantes)}'::jsonb))) where id = '${ORG}';`);
}

let seq = 0;
/** Um cliente novo com um lead sem dono em 'novo' (cada caso precisa do seu: o aviso entrega o lead uma vez só). */
function cliente(): { tel: string; lead: string } {
  seq += 1;
  const sufixo = String(seq).padStart(2, "0");
  const tel = `55119876600${sufixo}`;
  const lead = lastLine(
    sql(`
      insert into public.contacts (organization_id, name, phone_number) values ('${ORG}', 'Cliente ${sufixo}', '+${tel}');
      insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id)
        select '${ORG}', '${FUNIL}', '${NOVO}', 'Lead ${sufixo}', ${seq}, id from public.contacts where organization_id = '${ORG}' and phone_number = '+${tel}';
      select l.id from public.crm_leads l join public.contacts c on c.id = l.contact_id where c.phone_number = '+${tel}' and l.organization_id = '${ORG}';
    `),
  );
  return { tel, lead };
}

/** O aviso do grupo: devolve quem recebeu (o user_id) ou '-'. */
const aviso = (tel: string) =>
  lastLine(sql(`select coalesce(user_id::text, '-') from public.fn_iavek_aviso_de_ajuda('${ORG}', array['${tel}']::text[], null);`));

/** O guardião do lead sem guardião agendado: devolve o guardião gravado (ou 'SEM'). */
function guardiaoDoAgendamento(): string {
  const { lead } = cliente();
  return lastLine(
    sql(`
      select public.fn_iavek_guardiao_do_agendamento('${ORG}', '${lead}', '${SDR1}');
      select coalesce(sdr_user_id::text, 'SEM') from public.crm_leads where id = '${lead}';
    `),
  );
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${SDR1}', 'v631-s1@invariant.test'), ('${SDR2}', 'v631-s2@invariant.test'),
      ('${GER}', 'v631-g@invariant.test'), ('${SAIU}', 'v631-x@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}', 'vez-guardiao-631', 'V631', 'V631')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${SDR1}', '${ORG}', 'agent', now()), ('${SDR2}', '${ORG}', 'agent', now()),
      ('${GER}', '${ORG}', 'agent', now()), ('${SAIU}', '${ORG}', 'agent', now())
      on conflict do nothing;
    update public.user_organizations set interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"sdr"}'::jsonb
     where organization_id = '${ORG}' and user_id in ('${SDR1}', '${SDR2}', '${SAIU}');
    -- a pessoa da lista que virou gerente (o caso da Lupa 170647)
    update public.user_organizations set interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"gerente"}'::jsonb
     where organization_id = '${ORG}' and user_id = '${GER}';
    update public.user_organizations set revoked_at = now() where organization_id = '${ORG}' and user_id = '${SAIU}';
    update public.crm_pipelines set is_default = false where organization_id = '${ORG}';
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values ('${FUNIL}', '${ORG}', 'Funil 631', 'funil-631', true)
      on conflict (id) do update set is_default = true;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${NOVO}', '${ORG}', '${FUNIL}', 'IA Atendendo', 'novo', 1),
      ('${SUPORTE}', '${ORG}', '${FUNIL}', 'Suporte IA', 'em-atendimento-ia', 2) on conflict (id) do nothing;
  `);
});

describe("0631 — o aviso do grupo (fn_iavek_aviso_de_ajuda) só dá a vez a SDR ativa", () => {
  it("a pessoa da lista que NÃO é SDR (gerente) é pulada: a vez vai à SDR da lista", () => {
    lista([GER, SDR1]);
    expect([aviso(cliente().tel), aviso(cliente().tel), aviso(cliente().tel)]).toEqual([SDR1, SDR1, SDR1]);
  });

  it("quem saiu da loja é pulado", () => {
    lista([SAIU, SDR1]);
    expect(aviso(cliente().tel)).toBe(SDR1);
  });

  it("nenhuma SDR ativa na lista (só a gerente): a regra de antes, as 'sdr' ativas da loja — nunca a gerente", () => {
    lista([GER]);
    expect([SDR1, SDR2]).toContain(aviso(cliente().tel));
  });

  it("a lista vazia: a regra de antes", () => {
    lista([]);
    expect([SDR1, SDR2]).toContain(aviso(cliente().tel));
  });
});

describe("0631 — o guardião do agendamento (fn_iavek_guardiao_do_agendamento) só dá a vez a SDR ativa", () => {
  it("a gerente da lista é pulada; a SDR da lista recebe", () => {
    lista([GER, SDR1]);
    expect([guardiaoDoAgendamento(), guardiaoDoAgendamento()]).toEqual([SDR1, SDR1]);
  });

  it("quem saiu da loja é pulado", () => {
    lista([SAIU, SDR2]);
    expect(guardiaoDoAgendamento()).toBe(SDR2);
  });

  it("nenhuma SDR ativa na lista, ou a lista vazia: a regra de antes — nunca a gerente nem quem saiu", () => {
    lista([GER, SAIU]);
    expect([SDR1, SDR2]).toContain(guardiaoDoAgendamento());
    lista([]);
    expect([SDR1, SDR2]).toContain(guardiaoDoAgendamento());
  });
});
