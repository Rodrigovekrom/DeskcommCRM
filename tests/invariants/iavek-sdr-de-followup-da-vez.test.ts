import { beforeAll, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.52 (migration 0634, CRM-254): a VEZ do SDR de Follow-up — rodízio entre os membros ATIVOS (aceitos e
 * não revogados) com a função 'sdr_followup', pela vez própria; sem nenhum, NULL e nada registrado. Não grava o lead.
 * Organização PRÓPRIA deste arquivo.
 */
const ORG = "a0d50000-0000-4000-8000-000000000001";
const ADMIN = "a0d50000-1111-4000-8000-000000000001";
const FU1 = "a0d50000-1111-4000-8000-000000000002";
const FU2 = "a0d50000-1111-4000-8000-000000000003";
const SAIU = "a0d50000-1111-4000-8000-000000000004";
const SDR = "a0d50000-1111-4000-8000-000000000005";
const FUNIL = "a0d50000-2222-4000-8000-000000000001";
const ETAPA = "a0d50000-2222-4000-8000-000000000002";

function lead(titulo: string): string {
  return lastLine(
    sql(`
      insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, source)
        values ('${ORG}', '${FUNIL}', '${ETAPA}', '${titulo}', 'whatsapp');
      select id from public.crm_leads where organization_id = '${ORG}' and title = '${titulo}';
    `),
  );
}

const daVez = (l: string) => lastLine(sql(`select coalesce(public.fn_iavek_sdr_followup_da_vez('${ORG}', '${l}')::text, 'NULO');`));
const registros = () =>
  Number(lastLine(sql(`select count(*) from public.iavek_rodizio_registros where organization_id = '${ORG}' and origem = 'sdr_followup';`)));
const funcao = (u: string, f: string) =>
  sql(`update public.user_organizations set interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"${f}"}'::jsonb
        where organization_id = '${ORG}' and user_id = '${u}';`);

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'fu-admin@invariant.test'), ('${FU1}', 'fu-1@invariant.test'), ('${FU2}', 'fu-2@invariant.test'),
      ('${SAIU}', 'fu-s@invariant.test'), ('${SDR}', 'fu-sdr@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}', 'sdr-followup-inv', 'FU', 'FU')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN}', '${ORG}', 'admin', now()), ('${SAIU}', '${ORG}', 'agent', now()), ('${SDR}', '${ORG}', 'agent', now())
      on conflict do nothing;
    update public.user_organizations set revoked_at = now() where organization_id = '${ORG}' and user_id = '${SAIU}';
    update public.crm_pipelines set is_default = false where organization_id = '${ORG}';
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values ('${FUNIL}', '${ORG}', 'Follow-up', 'fu-inv', true)
      on conflict (id) do update set is_default = true;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${ETAPA}', '${ORG}', '${FUNIL}', 'd03-10', 'd03-10-inv', 1000)
      on conflict (id) do nothing;
  `);
  funcao(SAIU, "sdr_followup");
  funcao(SDR, "sdr");
});

describe("0634 — a vez do SDR de Follow-up", () => {
  it("sem nenhum SDR de Follow-up ativo: NULO e nada registrado (a esteira segue a regra de antes)", () => {
    expect(daVez(lead("fu0"))).toBe("NULO");
    expect(registros()).toBe(0);
  });

  it("com dois ativos: rodízio (1, 2, 1), cada vez registrada", () => {
    sql(`insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
           ('${FU1}', '${ORG}', 'agent', now() - interval '2 minutes'), ('${FU2}', '${ORG}', 'agent', now() - interval '1 minute')
           on conflict do nothing;`);
    funcao(FU1, "sdr_followup");
    funcao(FU2, "sdr_followup");
    expect([daVez(lead("fu1")), daVez(lead("fu2")), daVez(lead("fu3"))]).toEqual([FU1, FU2, FU1]);
    expect(registros()).toBe(3);
  });

  it("quem saiu (revogado) e o SDR comum ('sdr') NUNCA recebem", () => {
    const vezes = [daVez(lead("fu4")), daVez(lead("fu5")), daVez(lead("fu6")), daVez(lead("fu7"))];
    expect(vezes).not.toContain(SAIU);
    expect(vezes).not.toContain(SDR);
  });

  it("o convite ainda não aceito não recebe", () => {
    sql(`update public.user_organizations set accepted_at = null where organization_id = '${ORG}' and user_id = '${FU2}';`);
    expect([daVez(lead("fu8")), daVez(lead("fu9"))]).toEqual([FU1, FU1]);
    sql(`update public.user_organizations set accepted_at = now() where organization_id = '${ORG}' and user_id = '${FU2}';`);
  });

  it("não grava o lead (quem grava o dono é a esteira)", () => {
    const l = lead("fu-nao-grava");
    daVez(l);
    expect(lastLine(sql(`select coalesce(owner_user_id::text, 'SEM') from public.crm_leads where id = '${l}';`))).toBe("SEM");
  });

  it("lead de outra organização (ou inexistente): NULO e nada registrado", () => {
    const antes = registros();
    expect(lastLine(sql(`select coalesce(public.fn_iavek_sdr_followup_da_vez('${ORG}', gen_random_uuid())::text, 'NULO');`))).toBe("NULO");
    expect(registros()).toBe(antes);
  });

  it("só o servidor chama: authenticated e anon não executam", () => {
    const r = lastLine(
      sql(`select has_function_privilege('authenticated', 'public.fn_iavek_sdr_followup_da_vez(uuid,uuid)', 'execute')
              or has_function_privilege('anon', 'public.fn_iavek_sdr_followup_da_vez(uuid,uuid)', 'execute');`),
    );
    expect(r).toBe("f");
  });
});
