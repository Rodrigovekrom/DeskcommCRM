import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_AGENT_A, GOV_LEAD, GOV_ORG, countAs, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * ia.vek v1.7.8 (migration 0586) — Passar Ficha, no BANCO.
 *
 *  1. A função "analista_ficha" fecha o CRM inteiro para o vínculo: mesmo com
 *     papel `viewer`, o analista não lê lead, contato, conversa nem funil, e
 *     `fn_user_role_in_org` devolve nulo (é o que o `requireRole` consulta).
 *  2. As tabelas da ficha não têm acesso nenhum pela sessão — nem do admin:
 *     tudo passa pelo servidor, que confere quem pede e registra a leitura.
 *  3. LGPD: anonimizar o contato apaga os dados da ficha e manda o documento
 *     para a fila de remoção do storage.
 */
const ANALISTA = "f1c4a000-1111-4000-8000-000000000001";
const VIEWER_COMUM = "f1c4a000-1111-4000-8000-000000000002";
const FICHA = "f1c4a000-2222-4000-8000-000000000001";
// Contato PRÓPRIO deste arquivo: o caso de LGPD o anonimiza, e os GOV_* são compartilhados.
const CONTATO = "f1c4a000-3333-4000-8000-000000000001";

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email) values ('${ANALISTA}', 'analista@invariant.test'), ('${VIEWER_COMUM}', 'viewer-ficha@invariant.test') on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings)
      values ('${ANALISTA}', '${GOV_ORG}', 'viewer', now(), '{"preset":"completa","funcao":"analista_ficha"}'::jsonb),
             ('${VIEWER_COMUM}', '${GOV_ORG}', 'viewer', now(), '{"preset":"completa"}'::jsonb)
      on conflict (user_id, organization_id) do update set interface_settings = excluded.interface_settings, role = excluded.role, revoked_at = null;
    insert into public.contacts (id, organization_id, name) values ('${CONTATO}', '${GOV_ORG}', 'Cliente da Ficha') on conflict (id) do nothing;
    insert into public.iavek_fichas (id, organization_id, lead_id, contact_id, enviada_por, dados)
      values ('${FICHA}', '${GOV_ORG}', null, '${CONTATO}', '${GOV_AGENT_A}', '{"cpf":"52998224725","renda_mensal":"5000"}'::jsonb)
      on conflict (id) do nothing;
    insert into public.iavek_ficha_documentos (organization_id, ficha_id, tipo, storage_path)
      values ('${GOV_ORG}', '${FICHA}', 'rg', '${GOV_ORG}/${FICHA}/doc-invariante.jpg');
  `);
});

describe("a função analista_ficha fecha o CRM no banco", () => {
  it("CONTROLE: um viewer comum da mesma organização lê o lead", () => {
    expect(countAs(VIEWER_COMUM, `select count(*) from public.crm_leads where id = '${GOV_LEAD}';`)).toBe(1);
  });

  it("o analista não lê lead, contato, conversa nem funil", () => {
    for (const tabela of ["crm_leads", "contacts", "conversations", "crm_pipelines"]) {
      expect(countAs(ANALISTA, `select count(*) from public.${tabela} where organization_id = '${GOV_ORG}';`), tabela).toBe(0);
    }
  });

  it("o analista lê SÓ a linha da própria organização (sem ela o app a trata como suspensa)", () => {
    expect(countAs(ANALISTA, `select count(*) from public.organizations where id = '${GOV_ORG}';`)).toBe(1);
    expect(countAs(ANALISTA, `select count(*) from public.organizations where id <> '${GOV_ORG}';`)).toBe(0);
  });

  it("para o analista, fn_user_role_in_org é nulo (o requireRole nega)", () => {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${ANALISTA}"}', false);
      select coalesce(public.fn_user_role_in_org('${GOV_ORG}'), 'NULO');
    `);
    expect(lastLine(out)).toBe("NULO");
  });
});

describe("ninguém que não é admin tira a função 'analista_ficha' (nem a própria)", () => {
  it("a analista não troca nem apaga o próprio vínculo pela sessão", () => {
    let n = -1;
    try {
      n = writeCountAs(ANALISTA, `update public.user_organizations set interface_settings = '{"preset":"completa"}'::jsonb where user_id = '${ANALISTA}'`);
    } catch { n = 0; }
    expect(n).toBe(0);
    try {
      n = writeCountAs(ANALISTA, `delete from public.user_organizations where user_id = '${ANALISTA}'`);
    } catch { n = 0; }
    expect(n).toBe(0);
  });

  it("um vendedor e um viewer comum também não (nem para si, nem para a analista)", () => {
    for (const quem of [GOV_AGENT_A, VIEWER_COMUM]) {
      let n = -1;
      try {
        n = writeCountAs(quem, `update public.user_organizations set interface_settings = '{"preset":"completa"}'::jsonb, role = 'admin' where user_id in ('${quem}', '${ANALISTA}')`);
      } catch { n = 0; }
      expect(n).toBe(0);
    }
    expect(lastLine(sql(`select interface_settings->>'funcao' from public.user_organizations where user_id = '${ANALISTA}';`))).toBe("analista_ficha");
  });
});

describe("as tabelas da ficha não abrem para a sessão", () => {
  it("nem o admin, nem o vendedor que enviou, nem o analista leem pela sessão", () => {
    for (const quem of [GOV_ADMIN, GOV_AGENT_A, ANALISTA]) {
      let n = -1;
      try {
        n = countAs(quem, `select count(*) from public.iavek_fichas;`);
      } catch {
        n = 0; // sem GRANT: permissão negada também é "não lê"
      }
      expect(n).toBe(0);
    }
  });

  it("e ninguém escreve pela sessão", () => {
    let n = -1;
    try {
      n = writeCountAs(GOV_ADMIN, `update public.iavek_fichas set status = 'aprovada' where id = '${FICHA}'`);
    } catch {
      n = 0;
    }
    expect(n).toBe(0);
  });
});

describe("LGPD: anonimizar o contato apaga a ficha", () => {
  it("dados zerados, documento na fila de remoção e fora da tabela", () => {
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id = '${CONTATO}';`);
    expect(lastLine(sql(`select dados::text || '|' || anonimizada from public.iavek_fichas where id = '${FICHA}';`))).toBe("{}|true");
    expect(lastLine(sql(`select count(*) from public.storage_redaction_queue where bucket = 'iavek-fichas' and object_path = '${GOV_ORG}/${FICHA}/doc-invariante.jpg';`))).toBe("1");
    expect(lastLine(sql(`select count(*) from public.iavek_ficha_documentos where ficha_id = '${FICHA}';`))).toBe("0");
  });
});
