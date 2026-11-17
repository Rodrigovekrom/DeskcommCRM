/**
 * ia.vek — a lista de telas que vale por cima da função é SÓ apresentação (decisão do Rodrigo 17/11, Lupa 204427).
 *
 * A prova no banco de verdade: o MESMO vendedor, antes e depois de ganhar a lista própria (com Tarefas, Notificações e até
 * Entrada de leads e Contatos marcadas), vê EXATAMENTE as mesmas contagens de contatos, conversas, negócios e tarefas.
 * A RLS segue a FUNÇÃO (interface_settings->>'funcao'), e nenhuma regra de banco lê `destinos` (só o CHECK de formato).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_ORG, countAs, lastLine, seedGov, sql } from "./gov-helpers";

const CONTAS = {
  contatos: "select count(*) from public.contacts;",
  conversas: "select count(*) from public.conversations;",
  negocios: "select count(*) from public.crm_leads;",
  tarefas: "select count(*) from public.crm_tasks;",
};
const contar = () =>
  Object.fromEntries(Object.entries(CONTAS).map(([k, q]) => [k, countAs(GOV_AGENT_A, q)])) as Record<keyof typeof CONTAS, number>;

let antes: Record<string, unknown> | null = null;

beforeAll(() => {
  seedGov();
  const linha = lastLine(
    sql(`select interface_settings::text from public.user_organizations where user_id = '${GOV_AGENT_A}' and organization_id = '${GOV_ORG}';`),
  );
  antes = linha ? (JSON.parse(linha) as Record<string, unknown>) : null;
  // o vendedor, SEM lista própria
  sql(`
    update public.user_organizations
       set interface_settings = '{"preset":"completa","funcao":"vendedor"}'::jsonb
     where user_id = '${GOV_AGENT_A}' and organization_id = '${GOV_ORG}';
  `);
});

afterAll(() => {
  if (antes) {
    sql(`
      update public.user_organizations set interface_settings = '${JSON.stringify(antes).replace(/'/g, "''")}'::jsonb
       where user_id = '${GOV_AGENT_A}' and organization_id = '${GOV_ORG}';
    `);
  }
});

describe("a lista própria do vendedor não abre DADOS", () => {
  it("as mesmas contagens de contatos, conversas, negócios e tarefas antes e depois de ganhar a lista", () => {
    const semLista = contar();
    sql(`
      update public.user_organizations
         set interface_settings = '{"preset":"completa","funcao":"vendedor","destinos":["/app/meu-dia","/app/pipeline","/app/agenda","/app/tasks","/app/meus-numeros","/app/settings/notifications","/app/inbox","/app/contacts"]}'::jsonb
       where user_id = '${GOV_AGENT_A}' and organization_id = '${GOV_ORG}';
    `);
    const comLista = contar();
    expect(comLista).toEqual(semLista);
  });

  it("nenhuma função de banco lê a lista de telas (só o CHECK de formato a menciona)", () => {
    const out = sql(`
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosrc ilike '%''destinos''%';
    `);
    expect(Number(lastLine(out))).toBe(0);
  });
});
