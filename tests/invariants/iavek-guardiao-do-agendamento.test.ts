import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.48 (migration 0628) — o lead SEM DONO e SEM GUARDIÃO que alguém de fora do SDR agenda ganha guardião
 * da LISTA do rodízio (a mesma do aviso do grupo, 0623). Decisão do Maestro (113810): "todo lead tem SDR guardião";
 * o lead que JÁ tem guardião fica como está.
 *
 * Organização PRÓPRIA deste arquivo. O rodízio dos leads NOVOS fica DESLIGADO (como na Fenômenos): a lista só diz
 * "quem recebe".
 */
const ORG = "a0d48000-0000-4000-8000-000000000001";
const ADMIN = "a0d48000-1111-4000-8000-000000000001";
const DAIANE = "a0d48000-1111-4000-8000-000000000002";
const PALOMA = "a0d48000-1111-4000-8000-000000000003";
const VENDEDOR = "a0d48000-1111-4000-8000-000000000004";
const SAIU = "a0d48000-1111-4000-8000-000000000005";
const OUTRA_SDR = "a0d48000-1111-4000-8000-000000000006";
const FUNIL = "a0d48000-2222-4000-8000-000000000001";
const ETAPA = "a0d48000-2222-4000-8000-000000000002";

function lista(participantes: string[]) {
  sql(`update public.organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{iavek}', jsonb_build_object('rodizio', jsonb_build_object('ativo', false, 'participantes', '${JSON.stringify(participantes)}'::jsonb))) where id = '${ORG}';`);
}

/** Um lead aberto, já com o VENDEDOR de dono (a rota passou o lead antes de chamar a função), e o guardião dado. */
function lead(titulo: string, guardiao: string | null = null): string {
  return lastLine(
    sql(`
      insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, source, owner_user_id, owner_kind, sdr_user_id)
        values ('${ORG}', '${FUNIL}', '${ETAPA}', '${titulo}', 'whatsapp', '${VENDEDOR}', 'user', ${guardiao ? `'${guardiao}'` : "null"});
      select id from public.crm_leads where organization_id = '${ORG}' and title = '${titulo}';
    `),
  );
}

/** Chama a função como o SERVIDOR e devolve o guardião que o lead ficou (SEM = nenhum). */
function agendar(leadId: string): string {
  return lastLine(
    sql(`
      select public.fn_iavek_guardiao_do_agendamento('${ORG}', '${leadId}', '${VENDEDOR}');
      select coalesce(sdr_user_id::text, 'SEM') from public.crm_leads where id = '${leadId}';
    `),
  );
}

const registros = () =>
  Number(lastLine(sql(`select count(*) from public.iavek_rodizio_registros where organization_id = '${ORG}' and origem = 'guardiao_do_agendamento';`)));

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'ga-admin@invariant.test'), ('${DAIANE}', 'ga-d@invariant.test'), ('${PALOMA}', 'ga-p@invariant.test'),
      ('${VENDEDOR}', 'ga-v@invariant.test'), ('${SAIU}', 'ga-s@invariant.test'), ('${OUTRA_SDR}', 'ga-o@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}', 'guardiao-agenda-inv', 'GA', 'GA')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings) values
      ('${ADMIN}', '${ORG}', 'admin', now(), '{}'),
      ('${DAIANE}', '${ORG}', 'agent', now(), '{"funcao":"sdr"}'),
      ('${PALOMA}', '${ORG}', 'agent', now(), '{"funcao":"sdr"}'),
      ('${VENDEDOR}', '${ORG}', 'agent', now(), '{"funcao":"vendedor"}'),
      ('${SAIU}', '${ORG}', 'agent', now(), '{"funcao":"sdr"}')
      on conflict do nothing;
    update public.user_organizations set revoked_at = now() where user_id = '${SAIU}' and organization_id = '${ORG}';
    update public.crm_pipelines set is_default = false where organization_id = '${ORG}';
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values ('${FUNIL}', '${ORG}', 'Entrada', 'entrada-ga', true)
      on conflict (id) do update set is_default = true;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${ETAPA}', '${ORG}', '${FUNIL}', 'Novo', 'novo-ga', 1000)
      on conflict (id) do nothing;
  `);
});

describe("0628 — o guardião do lead sem guardião agendado por quem não é SDR", () => {
  it("o lead sem guardião ganha guardião da LISTA, em rodízio (Daiane, Paloma, Daiane)", () => {
    lista([DAIANE, PALOMA]);
    expect([agendar(lead("ga1")), agendar(lead("ga2")), agendar(lead("ga3"))]).toEqual([DAIANE, PALOMA, DAIANE]);
    expect(registros()).toBe(3);
  });

  it("o lead que JÁ tem guardião não muda (e não gasta a vez)", () => {
    const antes = registros();
    const l = lead("ga-com-guardiao", OUTRA_SDR);
    expect(agendar(l)).toBe(OUTRA_SDR);
    expect(registros()).toBe(antes);
  });

  it("o dono não é mexido: quem agendou segue dono", () => {
    const l = lead("ga-dono");
    agendar(l);
    expect(lastLine(sql(`select owner_user_id from public.crm_leads where id = '${l}';`))).toBe(VENDEDOR);
  });

  it("quem saiu da loja (vínculo revogado) não recebe, mesmo estando na lista", () => {
    lista([SAIU, PALOMA]);
    expect(agendar(lead("ga-saiu"))).toBe(PALOMA);
  });

  it("lista vazia: a regra de antes da 0623 (as 'sdr' ativas); ninguém = o lead segue sem guardião", () => {
    lista([]);
    expect([DAIANE, PALOMA]).toContain(agendar(lead("ga-vazia")));
    sql(`update public.user_organizations set revoked_at = now() where organization_id = '${ORG}' and user_id in ('${DAIANE}', '${PALOMA}');`);
    const antes = registros();
    expect(agendar(lead("ga-ninguem"))).toBe("SEM");
    expect(registros()).toBe(antes);
    sql(`update public.user_organizations set revoked_at = null where organization_id = '${ORG}' and user_id in ('${DAIANE}', '${PALOMA}');`);
  });

  it("só o servidor chama: authenticated e anon não executam a função", () => {
    const r = lastLine(
      sql(`select has_function_privilege('authenticated', 'public.fn_iavek_guardiao_do_agendamento(uuid,uuid,uuid)', 'execute')
              or has_function_privilege('anon', 'public.fn_iavek_guardiao_do_agendamento(uuid,uuid,uuid)', 'execute');`),
    );
    expect(r).toBe("f");
  });

  it("lead de OUTRA organização: a função não acha e não grava nada", () => {
    const antes = registros();
    expect(lastLine(sql(`select coalesce(public.fn_iavek_guardiao_do_agendamento('${ORG}', gen_random_uuid(), '${VENDEDOR}')::text, 'NULO');`))).toBe("NULO");
    expect(registros()).toBe(antes);
  });
});
