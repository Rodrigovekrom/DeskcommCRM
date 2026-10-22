import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_ORG, countAs, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * ia.vek v1.7.9 (migration 0587) — preferências de visualização por pessoa.
 * Cada um lê e grava SÓ a própria linha; ninguém grava em nome de outro; quem
 * é de outra organização não vê nada.
 */
const OUTRA_ORG = "e1fe0000-0000-4000-8000-000000000001";
const DE_FORA = "e1fe0000-1111-4000-8000-000000000001";

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${DE_FORA}', 'pref-fora@invariant.test') on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${OUTRA_ORG}', 'pref-inv-b', 'Pref B', 'Pref B') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values ('${DE_FORA}', '${OUTRA_ORG}', 'admin', now()) on conflict do nothing;
    delete from public.iavek_preferencias_de_tela where organization_id = '${GOV_ORG}';
  `);
});

describe("preferências de tela: cada um só a própria", () => {
  it("o vendedor grava e lê a PRÓPRIA linha", () => {
    expect(
      writeCountAs(GOV_AGENT_A, `insert into public.iavek_preferencias_de_tela (organization_id, user_id, tela, valor) values ('${GOV_ORG}', '${GOV_AGENT_A}', 'pipeline', '{"ordem":"atividade"}')`),
    ).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.iavek_preferencias_de_tela where user_id = '${GOV_AGENT_A}';`)).toBe(1);
  });

  it("o colega da MESMA organização não lê nem altera a linha dele", () => {
    expect(countAs(GOV_AGENT_B, `select count(*) from public.iavek_preferencias_de_tela where user_id = '${GOV_AGENT_A}';`)).toBe(0);
    expect(writeCountAs(GOV_AGENT_B, `update public.iavek_preferencias_de_tela set valor = '{}' where user_id = '${GOV_AGENT_A}'`)).toBe(0);
  });

  it("ninguém grava em nome de outro (user_id alheio)", () => {
    expect(
      writeCountAs(GOV_AGENT_B, `insert into public.iavek_preferencias_de_tela (organization_id, user_id, tela, valor) values ('${GOV_ORG}', '${GOV_AGENT_A}', 'pipeline', '{}') on conflict do nothing`),
    ).toBe(0);
  });

  it("quem é de OUTRA organização não lê nada e não grava na nossa", () => {
    expect(countAs(DE_FORA, `select count(*) from public.iavek_preferencias_de_tela;`)).toBe(0);
    expect(
      writeCountAs(DE_FORA, `insert into public.iavek_preferencias_de_tela (organization_id, user_id, tela, valor) values ('${GOV_ORG}', '${DE_FORA}', 'pipeline', '{}')`),
    ).toBe(0);
  });

  it("a linha continua a mesma depois das tentativas", () => {
    expect(lastLine(sql(`select valor->>'ordem' from public.iavek_preferencias_de_tela where user_id = '${GOV_AGENT_A}';`))).toBe("atividade");
  });
});
