/**
 * ia.vek v1.9.47 (0627): `iavek_entregas_de_email` (a entrega de cada e-mail da Resend) é EXCLUSIVA do servidor:
 * RLS ligada, zero policies, grants revogados de anon/authenticated. Prova comportamental: nem o admin da PRÓPRIA
 * organização nem quem é de OUTRA leem, gravam ou apagam; o service_role (controle positivo) grava e lê.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const OUTRA_ORG = "e1fe0627-0000-4000-8000-000000000001";
const DE_FORA = "e1fe0627-1111-4000-8000-000000000001";

function como(papel: "authenticated" | "anon" | "service_role", userId: string | null, comando: string): string {
  return sql(`set role ${papel};
    ${userId ? `select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);` : ""}
    ${comando};`);
}

function recusado(userId: string | null, comando: string, papel: "authenticated" | "anon" = "authenticated"): string {
  try {
    como(papel, userId, comando);
  } catch (err) {
    return motivoDoErro(err);
  }
  return "PASSOU";
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${DE_FORA}', 'ent0627-fora@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${OUTRA_ORG}', 'ent0627-inv-b', 'Ent B', 'Ent B') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${DE_FORA}', '${OUTRA_ORG}', 'admin', now()) on conflict do nothing;
    insert into public.iavek_entregas_de_email (mensagem_id, organization_id, tipo, recurso_id) values
      ('re_inv_0627_a', '${GOV_ORG}', 'team_invite', 'convite-a'), ('re_inv_0627_b', '${OUTRA_ORG}', 'team_invite', 'convite-b')
      on conflict do nothing;
  `);
});

describe("v1.9.47 (0627): a entrega dos e-mails é só do servidor", () => {
  it("o admin da PRÓPRIA organização não lê (nem a própria linha)", () => {
    expect(recusado(GOV_ADMIN, `select count(*) from public.iavek_entregas_de_email where organization_id = '${GOV_ORG}'`)).toMatch(/permission denied/);
  });
  it("quem é de OUTRA organização não lê a nossa", () => {
    expect(recusado(DE_FORA, `select count(*) from public.iavek_entregas_de_email where organization_id = '${GOV_ORG}'`)).toMatch(/permission denied/);
  });
  it("anon não lê", () => {
    expect(recusado(null, `select count(*) from public.iavek_entregas_de_email`, "anon")).toMatch(/permission denied/);
  });
  it("ninguém logado grava, muda o estado nem apaga", () => {
    expect(recusado(GOV_ADMIN, `insert into public.iavek_entregas_de_email (mensagem_id, organization_id) values ('re_forjado', '${GOV_ORG}')`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `update public.iavek_entregas_de_email set estado = 'entregue' where mensagem_id = 're_inv_0627_a'`)).toMatch(/permission denied/);
    expect(recusado(DE_FORA, `delete from public.iavek_entregas_de_email where mensagem_id = 're_inv_0627_a'`)).toMatch(/permission denied/);
  });
  it("controle positivo: o service_role muda o estado e lê", () => {
    const saida = como("service_role", null, `update public.iavek_entregas_de_email set estado = 'voltou' where mensagem_id = 're_inv_0627_b';
      select estado from public.iavek_entregas_de_email where mensagem_id = 're_inv_0627_b'`);
    expect(saida.trim().split("\n").at(-1)).toBe("voltou");
  });
  it("o CHECK do estado recusa valor fora da lista", () => {
    let motivo = "PASSOU";
    try {
      sql(`update public.iavek_entregas_de_email set estado = 'aberto' where mensagem_id = 're_inv_0627_a';`);
    } catch (err) {
      motivo = motivoDoErro(err);
    }
    expect(motivo).toMatch(/check constraint|violates/);
  });
  it("a linha da nossa organização segue intacta depois das tentativas", () => {
    expect(sql(`select estado || '|' || recurso_id from public.iavek_entregas_de_email where mensagem_id = 're_inv_0627_a';`).trim().split("\n").at(-1)).toBe("enviado|convite-a");
  });
});
