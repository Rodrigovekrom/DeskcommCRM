import { beforeAll, describe, expect, it } from "vitest";

import { countAs, lastLine, sql } from "./gov-helpers";

/**
 * ia.vek v1.7.7 (migration 0585) — rodízio de leads, no BANCO.
 *
 * Organização PRÓPRIA deste arquivo (o gatilho só age no funil padrão e muda
 * dono de lead — os GOV_* são compartilhados).
 *
 *  1. Ligado: 3 leads novos sem dono vão para 3 vendedores diferentes, na ordem.
 *  2. Desmarcado não recebe; desligado nada muda; importação não entra.
 *  3. Contato que já tem dono continua com o mesmo dono (sem gastar a vez).
 *  4. A conversa livre do contato vai junto, SEM calar a IA (bot_silenced_until).
 *  5. Distribuir os antigos: prévia não muda nada; confirmar entrega.
 *  6. O registro (iavek_rodizio_registros) é do admin: o vendedor da mesma
 *     organização lê zero, o admin de OUTRA organização lê zero.
 */
const ORG = "a0d12000-0000-4000-8000-000000000001";
const ORG_B = "a0d12000-0000-4000-8000-000000000002";
const ADMIN = "a0d12000-1111-4000-8000-000000000001";
const V1 = "a0d12000-1111-4000-8000-000000000002";
const V2 = "a0d12000-1111-4000-8000-000000000003";
const V3 = "a0d12000-1111-4000-8000-000000000004";
const ADMIN_B = "a0d12000-1111-4000-8000-000000000005";
const FUNIL = "a0d12000-2222-4000-8000-000000000001";
const ETAPA = "a0d12000-2222-4000-8000-000000000002";
const SESSAO = "a0d12000-3333-4000-8000-000000000001";

function config(ativo: boolean, participantes: string[]) {
  sql(`update public.organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{iavek}', jsonb_build_object('rodizio', jsonb_build_object('ativo', ${ativo}, 'participantes', '${JSON.stringify(participantes)}'::jsonb))) where id = '${ORG}';`);
}

/** Cria um lead sem dono e devolve o dono que ele ganhou ('' = nenhum). */
function leadNovo(titulo: string, extra: { contato?: string; source?: string } = {}): string {
  const contato = extra.contato ? `'${extra.contato}'` : "null";
  const out = sql(`
    insert into public.crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, source)
      values ('${ORG}', '${FUNIL}', '${ETAPA}', ${contato}, '${titulo}', '${extra.source ?? "whatsapp"}');
    select coalesce(owner_user_id::text, '') from public.crm_leads where organization_id = '${ORG}' and title = '${titulo}';
  `);
  return lastLine(out);
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${ADMIN}', 'rod-admin@invariant.test'), ('${V1}', 'rod-v1@invariant.test'), ('${V2}', 'rod-v2@invariant.test'),
      ('${V3}', 'rod-v3@invariant.test'), ('${ADMIN_B}', 'rod-admin-b@invariant.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'rodizio-inv', 'Rodízio', 'Rodízio'), ('${ORG_B}', 'rodizio-inv-b', 'Rodízio B', 'Rodízio B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ADMIN}', '${ORG}', 'admin', now()), ('${V1}', '${ORG}', 'agent', now()), ('${V2}', '${ORG}', 'agent', now()),
      ('${V3}', '${ORG}', 'agent', now()), ('${ADMIN_B}', '${ORG_B}', 'admin', now())
      on conflict do nothing;
    update public.crm_pipelines set is_default = false where organization_id = '${ORG}';
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values ('${FUNIL}', '${ORG}', 'Entrada', 'entrada-rodizio', true)
      on conflict (id) do update set is_default = true;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values ('${ETAPA}', '${ORG}', '${FUNIL}', 'Novo', 'novo-rodizio', 1000)
      on conflict (id) do nothing;
    insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted, status)
      values ('${SESSAO}', '${ORG}', 'rodizio-inv', '\\x00'::bytea, 'STOPPED') on conflict (id) do nothing;
  `);
});

describe("rodízio de leads novos", () => {
  it("desligado (padrão): nada muda", () => {
    expect(leadNovo("r0 desligado")).toBe("");
  });

  it("ligado: 3 leads novos vão para 3 vendedores diferentes, na ordem marcada", () => {
    config(true, [V1, V2, V3]);
    expect([leadNovo("r1"), leadNovo("r2"), leadNovo("r3")]).toEqual([V1, V2, V3]);
  });

  it("desmarcado não recebe", () => {
    config(true, [V1, V3]);
    const donos = [leadNovo("r4"), leadNovo("r5")];
    expect(donos).not.toContain(V2);
    expect(new Set(donos)).toEqual(new Set([V1, V3]));
  });

  it("importação de planilha não entra no rodízio", () => {
    expect(leadNovo("r6 importado", { source: "import" })).toBe("");
  });

  it("contato que já tem dono continua com o MESMO dono, e a conversa livre vai junto sem calar a IA", () => {
    const contato = "a0d12000-4444-4000-8000-000000000001";
    sql(`
      insert into public.contacts (id, organization_id, name) values ('${contato}', '${ORG}', 'Cliente que volta') on conflict (id) do nothing;
      insert into public.crm_leads (organization_id, pipeline_id, stage_id, contact_id, title, source, owner_user_id, owner_kind)
        values ('${ORG}', '${FUNIL}', '${ETAPA}', '${contato}', 'r7 antigo', 'manual', '${V2}', 'user');
      insert into public.conversations (organization_id, contact_id, channel_session_id, status) values ('${ORG}', '${contato}', '${SESSAO}', 'open');
    `);
    // V2 está desmarcado, e mesmo assim recebe: o cliente é dele.
    expect(leadNovo("r7 volta", { contato })).toBe(V2);
    expect(lastLine(sql(`select origem from public.iavek_rodizio_registros r join public.crm_leads l on l.id = r.lead_id where l.title = 'r7 volta';`))).toBe("mesmo_dono");
    expect(
      lastLine(sql(`select coalesce(assigned_to_user_id::text,'') || '|' || coalesce(bot_silenced_until::text,'nulo') from public.conversations where contact_id = '${contato}';`)),
    ).toBe(`${V2}|nulo`);
  });
});

describe("distribuir os antigos sem dono", () => {
  it("prévia não muda nada; confirmar entrega e registra", () => {
    config(false, [V1, V2, V3]);
    leadNovo("d1");
    leadNovo("d2");
    leadNovo("d3");
    const semDono = () =>
      lastLine(sql(`select count(*) from public.crm_leads where organization_id = '${ORG}' and status = 'open' and owner_user_id is null and source <> 'import';`));
    const antes = semDono();
    const previa = lastLine(sql(`select sum(quantidade + mesmo_dono) from public.fn_iavek_rodizio_distribuir('${ORG}', '${ADMIN}', false);`));
    expect(previa).toBe(String(Number(antes) + 1)); // + o importado (é lead antigo sem dono também)
    expect(semDono()).toBe(antes);
    sql(`select * from public.fn_iavek_rodizio_distribuir('${ORG}', '${ADMIN}', true);`);
    expect(semDono()).toBe("0");
    expect(Number(lastLine(sql(`select count(*) from public.iavek_rodizio_registros where organization_id = '${ORG}' and origem = 'distribuicao';`)))).toBeGreaterThan(0);
  });
});

describe("o registro do rodízio é do admin (RLS por JWT)", () => {
  it("admin lê; vendedor da MESMA org lê zero; admin de OUTRA org lê zero", () => {
    const q = `select count(*) from public.iavek_rodizio_registros where organization_id = '${ORG}';`;
    expect(countAs(ADMIN, q)).toBeGreaterThan(0);
    expect(countAs(V1, q)).toBe(0);
    expect(countAs(ADMIN_B, q)).toBe(0);
    expect(countAs(ADMIN_B, `select count(*) from public.iavek_rodizio_registros;`)).toBe(0);
  });

  it("ninguém escreve pela sessão", () => {
    let escreveu = true;
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', false);
        insert into public.iavek_rodizio_registros (organization_id, lead_id, user_id, origem)
          select '${ORG}', id, '${V1}', 'lead_novo' from public.crm_leads where organization_id = '${ORG}' limit 1;
      `);
    } catch {
      escreveu = false;
    }
    expect(escreveu).toBe(false);
  });
});
