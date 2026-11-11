/**
 * ia.vek v1.9.46 (0622): `iavek_0622_retencao_antes` guarda, para a volta, o media_retention_days de antes de cada
 * organização que a 0622 baixou de 365 para 90. É tabela EXCLUSIVA do servidor (a volta roda como postgres): RLS
 * ligada, zero policies, grants revogados de anon/authenticated. Prova comportamental: nem o admin da PRÓPRIA
 * organização nem quem é de OUTRA leem ou gravam nada.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const OUTRA_ORG = "e1fe0622-0000-4000-8000-000000000001";
const DE_FORA = "e1fe0622-1111-4000-8000-000000000001";

function comoMembro(userId: string, comando: string): string {
  return sql(`set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    ${comando};`);
}

function recusado(userId: string, comando: string): string {
  try {
    comoMembro(userId, comando);
  } catch (err) {
    return motivoDoErro(err);
  }
  return "PASSOU";
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${DE_FORA}', 'ret0622-fora@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${OUTRA_ORG}', 'ret0622-inv-b', 'Ret B', 'Ret B') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${DE_FORA}', '${OUTRA_ORG}', 'admin', now()) on conflict do nothing;
    insert into public.iavek_0622_retencao_antes (organization_id, media_retention_days_antes) values
      ('${GOV_ORG}', 365), ('${OUTRA_ORG}', 365) on conflict (organization_id) do nothing;
  `);
});

describe("v1.9.46 (0622): a lista da volta da retenção é só do servidor", () => {
  it("o admin da PRÓPRIA organização não lê (nem a própria linha)", () => {
    expect(recusado(GOV_ADMIN, `select count(*) from public.iavek_0622_retencao_antes where organization_id = '${GOV_ORG}'`)).toMatch(/permission denied/);
  });

  it("quem é de OUTRA organização não lê a nossa", () => {
    expect(recusado(DE_FORA, `select count(*) from public.iavek_0622_retencao_antes where organization_id = '${GOV_ORG}'`)).toMatch(/permission denied/);
  });

  it("ninguém logado grava nem apaga", () => {
    expect(recusado(GOV_ADMIN, `update public.iavek_0622_retencao_antes set media_retention_days_antes = 3650 where organization_id = '${GOV_ORG}'`)).toMatch(/permission denied/);
    expect(recusado(DE_FORA, `delete from public.iavek_0622_retencao_antes where organization_id = '${GOV_ORG}'`)).toMatch(/permission denied/);
  });

  it("as linhas seguem as mesmas depois das tentativas", () => {
    expect(sql(`select string_agg(media_retention_days_antes::text, ',' order by organization_id) from public.iavek_0622_retencao_antes where organization_id in ('${GOV_ORG}', '${OUTRA_ORG}');`).split("\n").at(-1)).toBe("365,365");
  });
});
