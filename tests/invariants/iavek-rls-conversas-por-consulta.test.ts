/**
 * ia.vek v1.7.4 — migration 0580: `conversations_select` avaliada por CONSULTA.
 *
 * A policy foi reescrita para o Postgres decidir "quem sou e o que vejo" uma vez
 * por consulta, em vez de chamar `fn_can_view_conversation` (+ guardião) em cada
 * linha. A promessa é de DESEMPENHO com a MESMA regra, então este arquivo mede a
 * regra, caso a caso, contra a antiga:
 *
 *   para cada pessoa (viewer, dois agentes, gerente, admin, SDR guardião, admin
 *   de plataforma, alguém de outra organização) e cada visibility_mode ('all',
 *   'own_and_unassigned', 'own'), o conjunto de conversas que a RLS devolve é
 *   IGUAL ao que `fn_can_view_conversation(...) or fn_iavek_e_guardiao_do_contato(...)`
 *   aprova para a mesma pessoa.
 *
 * E as contagens esperadas são escritas à mão: igualdade sozinha passaria se as
 * duas regras estivessem igualmente quebradas (ou com a tabela vazia).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const P = "05800000";
const ORG_TUDO = `${P}-0000-4000-8000-000000000001`;
const ORG_SEM_DONO = `${P}-0000-4000-8000-000000000002`;
const ORG_PROPRIO = `${P}-0000-4000-8000-000000000003`;
const ORG_FORA = `${P}-0000-4000-8000-000000000004`;
const ORGS = [ORG_TUDO, ORG_SEM_DONO, ORG_PROPRIO];

const VIEWER = `${P}-1111-4000-8000-000000000001`;
const AGENTE_A = `${P}-1111-4000-8000-000000000002`;
const AGENTE_B = `${P}-1111-4000-8000-000000000003`;
const GERENTE = `${P}-1111-4000-8000-000000000004`;
const ADMIN = `${P}-1111-4000-8000-000000000005`;
const SDR = `${P}-1111-4000-8000-000000000006`;
const PLATAFORMA = `${P}-1111-4000-8000-000000000007`;
const DE_FORA = `${P}-1111-4000-8000-000000000008`;

const PESSOAS = { VIEWER, AGENTE_A, AGENTE_B, GERENTE, ADMIN, SDR, PLATAFORMA, DE_FORA };

/** id determinístico por organização (1..3) e item (1..n). */
function id(bloco: string, org: number, n: number): string {
  return `${P}-${bloco}-4000-8000-0000000000${org}${n}`;
}

const listaDeOrgs = ORGS.map((o) => `'${o}'`).join(",");

function comoMembro(userId: string): string {
  return `set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);`;
}

function ultimaLinha(saida: string): string {
  return saida.trim().split("\n").at(-1) ?? "";
}

/** O que a RLS nova devolve para a pessoa. */
function pelaPolicy(userId: string): string {
  return ultimaLinha(
    sql(`${comoMembro(userId)}
      select coalesce(string_agg(id::text, ',' order by id), '-')
        from public.conversations where organization_id in (${listaDeOrgs});`),
  );
}

/** O que a regra ANTIGA aprova para a mesma pessoa (avaliada linha a linha). */
function pelaRegraAntiga(userId: string): string {
  return ultimaLinha(
    sql(`select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      select coalesce(string_agg(c.id::text, ',' order by c.id), '-')
        from public.conversations c
       where c.organization_id in (${listaDeOrgs})
         and (public.fn_can_view_conversation(c.organization_id, c.assigned_to_user_id)
              or public.fn_iavek_e_guardiao_do_contato(c.organization_id, c.contact_id));`),
  );
}

function quantas(lista: string): number {
  return lista === "-" || lista === "" ? 0 : lista.split(",").length;
}

beforeAll(() => {
  const membros = (org: string) =>
    [
      [VIEWER, "viewer"],
      [AGENTE_A, "agent"],
      [AGENTE_B, "agent"],
      [GERENTE, "manager"],
      [ADMIN, "admin"],
      [SDR, "agent"],
    ]
      .map(([u, papel]) => `('${u}', '${org}', '${papel}', now())`)
      .join(",\n");

  const porOrg = ORGS.map((org, i) => {
    const k = i + 1;
    const sessao = id("2222", k, 1);
    const funil = id("5555", k, 1);
    const etapa = id("6666", k, 1);
    // 4 conversas por organização, cada uma com o seu contato:
    //   1 do agente A · 2 do agente B · 3 sem dono · 4 do agente B, mas o SDR é guardião do contato
    const contatos = [1, 2, 3, 4].map(
      (n) => `('${id("3333", k, n)}', '${org}', 'Cliente 0580 ${k}.${n}')`,
    );
    const donos = [`'${AGENTE_A}'`, `'${AGENTE_B}'`, "null", `'${AGENTE_B}'`];
    const conversas = [1, 2, 3, 4].map(
      (n) =>
        `('${id("4444", k, n)}', '${org}', '${id("3333", k, n)}', '${sessao}', 'open', ${donos[n - 1]})`,
    );
    return `
      insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
        ${membros(org)}
        on conflict do nothing;
      do $seed$ begin
        insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
          values ('${sessao}', '${org}', 'g0580-${k}', '\\x00'::bytea);
      exception when unique_violation then null; end $seed$;
      insert into public.contacts (id, organization_id, display_name) values ${contatos.join(",")}
        on conflict do nothing;
      insert into public.crm_pipelines (id, organization_id, name, slug)
        values ('${funil}', '${org}', 'Funil 0580', 'g0580-funil') on conflict do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${etapa}', '${org}', '${funil}', 'Novo', 'novo', 1000) on conflict do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
        values ('${id("7777", k, 4)}', '${org}', '${funil}', '${etapa}', 'Lead guardado 0580', '${id("3333", k, 4)}')
        on conflict do nothing;
      update public.crm_leads set sdr_user_id = '${SDR}' where id = '${id("7777", k, 4)}';
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, assigned_to_user_id)
        values ${conversas.join(",")}
        on conflict do nothing;`;
  }).join("\n");

  sql(`
    insert into auth.users (id, email) values
      ${Object.entries(PESSOAS)
        .map(([nome, u]) => `('${u}', 'g0580-${nome.toLowerCase()}@invariant.test')`)
        .join(",\n")}
      on conflict do nothing;

    insert into public.organizations (id, slug, legal_name, display_name, settings) values
      ('${ORG_TUDO}', 'g0580-tudo', 'RLS 0580 tudo', 'RLS 0580 tudo', '{"visibility_mode":"all"}'),
      ('${ORG_SEM_DONO}', 'g0580-sem-dono', 'RLS 0580 sem dono', 'RLS 0580 sem dono', '{"visibility_mode":"own_and_unassigned"}'),
      ('${ORG_PROPRIO}', 'g0580-proprio', 'RLS 0580 próprio', 'RLS 0580 próprio', '{"visibility_mode":"own"}'),
      ('${ORG_FORA}', 'g0580-fora', 'RLS 0580 fora', 'RLS 0580 fora', '{}')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${DE_FORA}', '${ORG_FORA}', 'admin', now()) on conflict do nothing;

    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      select '${PLATAFORMA}', '${PLATAFORMA}', 'full', false, 'invariante 0580'
       where not exists (select 1 from public.platform_admins where user_id = '${PLATAFORMA}' and revoked_at is null);

    ${porOrg}
  `);
});

describe("conversations_select (0580): mesma regra, avaliada por consulta", () => {
  // 3 organizações × 4 conversas = 12. As contagens à mão:
  //   viewer/gerente/admin e plataforma: tudo (12)
  //   agente A: 'all' 4 + 'own_and_unassigned' (a dele + a sem dono) 2 + 'own' (a dele) 1 = 7
  //   agente B: 4 + (2 dele + sem dono) 3 + (2 dele) 2 = 9
  //   SDR guardião: 4 + (sem dono + a do contato guardado) 2 + (a guardada) 1 = 7
  //   de outra organização: 0
  const esperado: Record<keyof typeof PESSOAS, number> = {
    VIEWER: 12,
    AGENTE_A: 7,
    AGENTE_B: 9,
    GERENTE: 12,
    ADMIN: 12,
    SDR: 7,
    PLATAFORMA: 12,
    DE_FORA: 0,
  };

  for (const [nome, userId] of Object.entries(PESSOAS) as [keyof typeof PESSOAS, string][]) {
    it(`${nome}: a RLS devolve exatamente o que a regra antiga aprova (${esperado[nome]})`, () => {
      const nova = pelaPolicy(userId);
      const antiga = pelaRegraAntiga(userId);
      expect(quantas(nova)).toBe(esperado[nome]);
      expect(nova).toBe(antiga);
    });
  }

  it("a policy não chama mais a função por linha", () => {
    const texto = ultimaLinha(
      sql(`select replace(pg_get_expr(polqual, polrelid), E'\n', ' ') from pg_policy
            where polrelid = 'public.conversations'::regclass and polname = 'conversations_select';`),
    );
    expect(texto).toContain("fn_iavek_visao_de_conversas");
    expect(texto).not.toContain("fn_can_view_conversation");
  });

  it("as funções novas não são alcançáveis pela anon key", () => {
    for (const fn of ["fn_iavek_visao_de_conversas()", "fn_iavek_contatos_que_guardo()"]) {
      expect(
        ultimaLinha(sql(`select has_function_privilege('anon', 'public.${fn}', 'execute');`)),
      ).toBe("f");
    }
  });
});
