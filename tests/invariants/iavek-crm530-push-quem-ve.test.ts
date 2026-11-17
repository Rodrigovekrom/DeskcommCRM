import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ORG,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_MANAGER,
  GOV_VIEWER,
  GOV_CONV_AGENT_B,
  GOV_CONV_CLAIM,
  GOV_CONV_UNASSIGNED,
  GOV_SESSION,
  countAs,
  lastLine,
  seedGov,
  sql,
} from "./gov-helpers";
import { SQL_ASSUMIR_PAPEL, SQL_CANDIDATOS, SQL_CLAIMS, SQL_GERENCIA, SQL_PRAZO, claimsDe, sqlVe } from "@/lib/notifications/quem-ve";

/**
 * ia.vek CRM-530 — O AVISO NO CELULAR VAI SÓ A QUEM A POLICY DEIXA VER, E SÓ A MEMBRO ATIVO.
 *
 * `lib/notifications/quem-ve.ts` não copia a regra da `conversations_select`: ele PERGUNTA à policy, por inscrito, com a
 * sequência `begin; set local role authenticated; set_config(request.jwt.claims…); select exists(…); rollback`. Este
 * teste roda EXATAMENTE os mesmos textos SQL (importados do módulo) contra o banco de verdade e prova:
 *   1. os candidatos são só os membros ATIVOS com inscrição (o revogado e o que não aceitou ficam fora);
 *   2. para cada pessoa × conversa, o "vê" da sequência do módulo = o que a policy mostra a ela (`countAs`, o caminho
 *      do PostgREST). Se o módulo um dia montar as claims errado, ou deixar de assumir o papel, este teste quebra;
 *   3. a matriz não é trivial: há quem veja e quem não veja.
 */

const USER_REVOGADO = "c5300000-1111-4000-8000-000000000001";
const USER_PENDENTE = "c5300000-1111-4000-8000-000000000002";
/** A SDR de ENTRADA cujo contato passou ao Follow-up: a 0641 a esconde (o caso de LGPD que motivou o CRM-530). */
const USER_SDR = "c5300000-1111-4000-8000-000000000003";
const PIPE_FU = "c5300000-5555-4000-8000-000000000001";
const STAGE_FU = "c5300000-5555-4000-8000-000000000002";
const CONTATO_FU = "c5300000-3333-4000-8000-000000000001";
const LEAD_FU = "c5300000-6666-4000-8000-000000000001";
const CONV_FU = "c5300000-4444-4000-8000-000000000001";
const PESSOAS = [GOV_VIEWER, GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ADMIN];
const CONVERSAS = [GOV_CONV_UNASSIGNED, GOV_CONV_AGENT_B, GOV_CONV_CLAIM];

const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** Troca $1, $2 pelos literais (o psql do harness não recebe parâmetros). */
const comParametros = (texto: string, params: string[]) =>
  params.reduce((acc, p, i) => acc.split(`$${i + 1}`).join(literal(p)), texto);

/** A sequência do módulo, numa sessão só, para uma pessoa e uma linha. */
function moduloVe(userId: string, conversa: string): boolean {
  const out = sql(`
    begin;
    ${SQL_ASSUMIR_PAPEL};
    ${comParametros(SQL_CLAIMS, [claimsDe(userId), userId])};
    ${comParametros(sqlVe("conversations"), [conversa])};
    rollback;
  `);
  const linhas = out.split("\n").filter((l) => l === "t" || l === "f");
  const ultima = linhas[linhas.length - 1];
  if (ultima === undefined) throw new Error(`saída inesperada: ${out}`);
  return ultima === "t";
}

beforeAll(() => {
  seedGov();
  const subs = [...PESSOAS, USER_REVOGADO, USER_PENDENTE]
    .map(
      (u) =>
        `insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth)
           values ('${GOV_ORG}', '${u}', 'https://push.invariant.test/${u}', 'p', 'a') on conflict (endpoint) do nothing;`,
    )
    .join("\n");
  sql(`
    insert into auth.users (id, email) values
      ('${USER_REVOGADO}', 'crm530-revogado@invariant.test'),
      ('${USER_PENDENTE}', 'crm530-pendente@invariant.test')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at, interface_settings)
      values ('${USER_REVOGADO}', '${GOV_ORG}', 'admin', now(), now(), '{"preset":"completa"}'::jsonb) on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings)
      values ('${USER_PENDENTE}', '${GOV_ORG}', 'admin', null, '{"preset":"completa"}'::jsonb) on conflict do nothing;
    ${subs}
  `);
});

afterAll(() => {
  sql(`
    delete from public.push_subscriptions where endpoint like 'https://push.invariant.test/%';
    delete from public.conversations where id = '${CONV_FU}';
    delete from public.crm_leads where id = '${LEAD_FU}';
    delete from public.user_organizations where user_id in ('${USER_REVOGADO}', '${USER_PENDENTE}', '${USER_SDR}');
  `);
});

describe("CRM-530: o aviso vai só a quem a policy deixa ver, e só a membro ativo", () => {
  it("os candidatos são só os membros ATIVOS com inscrição (o revogado e o pendente ficam fora)", () => {
    const out = sql(`${comParametros(SQL_CANDIDATOS, [GOV_ORG])};`);
    const ids = new Set(out.split("\n").filter(Boolean));
    for (const p of PESSOAS) expect(ids.has(p)).toBe(true);
    expect(ids.has(USER_REVOGADO)).toBe(false);
    expect(ids.has(USER_PENDENTE)).toBe(false);
  });

  it("para cada pessoa × conversa, o 'vê' do módulo = o que a policy conversations_select mostra a ela", () => {
    const divergencias: string[] = [];
    let viram = 0;
    let naoViram = 0;
    for (const p of PESSOAS) {
      for (const c of CONVERSAS) {
        const policy = countAs(p, `select count(*) from public.conversations where id = '${c}';`) === 1;
        const modulo = moduloVe(p, c);
        if (policy !== modulo) divergencias.push(`${p.slice(-4)} × ${c.slice(-4)}: policy ${policy}, módulo ${modulo}`);
        if (modulo) viram += 1;
        else naoViram += 1;
      }
    }
    expect(divergencias).toEqual([]);
    // a matriz não é trivial (senão o teste passaria com um módulo que diz sempre "sim" ou sempre "não")
    expect(viram).toBeGreaterThan(0);
    expect(naoViram).toBeGreaterThan(0);
  });

  it("2ª config da org (guardião vê o que está sem dono, e uma pessoa é SDR): o módulo segue = a policy", () => {
    // fileParallelism false + banco do MOLDE por arquivo (harness-isola-por-arquivo): mudar a config aqui não vaza
    sql(`
      update public.organizations
         set settings = coalesce(settings, '{}'::jsonb)
                        || jsonb_build_object('iavek', coalesce(settings->'iavek', '{}'::jsonb)
                             || jsonb_build_object('guardiao_ve_sem_dono', true, 'guardiao_ve_sem_dono_desde', '2026-01-01T00:00:00Z'))
       where id = '${GOV_ORG}';
      update public.user_organizations
         set interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"sdr"}'::jsonb
       where user_id = '${GOV_AGENT_A}' and organization_id = '${GOV_ORG}';
    `);
    const divergencias: string[] = [];
    for (const p of PESSOAS) {
      for (const c of CONVERSAS) {
        const policy = countAs(p, `select count(*) from public.conversations where id = '${c}';`) === 1;
        const modulo = moduloVe(p, c);
        if (policy !== modulo) divergencias.push(`${p.slice(-4)} × ${c.slice(-4)}: policy ${policy}, módulo ${modulo}`);
      }
    }
    expect(divergencias).toEqual([]);
  });

  it("a SDR ESCONDIDA pela 0641 (o contato dela foi ao Follow-up) NÃO recebe o aviso daquela conversa; o módulo = a policy", () => {
    sql(`
      insert into auth.users (id, email) values ('${USER_SDR}', 'crm530-sdr@invariant.test') on conflict do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings)
        values ('${USER_SDR}', '${GOV_ORG}', 'agent', now(), '{"preset":"completa","funcao":"sdr"}'::jsonb) on conflict do nothing;
      insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth)
        values ('${GOV_ORG}', '${USER_SDR}', 'https://push.invariant.test/${USER_SDR}', 'p', 'a') on conflict (endpoint) do nothing;
      insert into public.crm_pipelines (id, organization_id, name, slug)
        values ('${PIPE_FU}', '${GOV_ORG}', 'Follow-up CRM-530', 'fu-crm530') on conflict do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${STAGE_FU}', '${GOV_ORG}', '${PIPE_FU}', 'Fase 1', 'fase-1', 1000) on conflict do nothing;
      insert into public.contacts (id, organization_id, display_name)
        values ('${CONTATO_FU}', '${GOV_ORG}', 'Contato no Follow-up CRM-530') on conflict do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
        values ('${LEAD_FU}', '${GOV_ORG}', '${PIPE_FU}', '${STAGE_FU}', 'Lead no Follow-up', '${CONTATO_FU}') on conflict do nothing;
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
        values ('${CONV_FU}', '${GOV_ORG}', '${CONTATO_FU}', '${GOV_SESSION}', 'open') on conflict do nothing;
    `);
    // CONTROLE (a prova de que é a 0641 que a esconde): sem o Follow-up ligado na org, a SDR (own_and_unassigned) VÊ a
    // conversa sem dono, e o módulo manda para ela
    expect(countAs(USER_SDR, `select count(*) from public.conversations where id = '${CONV_FU}';`)).toBe(1);
    expect(moduloVe(USER_SDR, CONV_FU)).toBe(true);
    // liga o Follow-up: o lead do contato está SÓ no funil de Follow-up e não é dela -> a 0641 a esconde
    sql(`
      update public.organizations
         set settings = coalesce(settings, '{}'::jsonb)
                        || jsonb_build_object('esteira', coalesce(settings->'esteira', '{}'::jsonb)
                             || jsonb_build_object('followup', jsonb_build_object('pipeline_id', '${PIPE_FU}')))
       where id = '${GOV_ORG}';
    `);
    // ela está entre os candidatos (é membro ativa e inscrita): o que a tira é a policy, não o filtro de candidatos
    const cand = new Set(sql(`${comParametros(SQL_CANDIDATOS, [GOV_ORG])};`).split("\n").filter(Boolean));
    expect(cand.has(USER_SDR)).toBe(true);
    // a 0641 a esconde: a policy NÃO mostra a conversa, e o módulo NÃO manda
    const policy = countAs(USER_SDR, `select count(*) from public.conversations where id = '${CONV_FU}';`) === 1;
    expect(policy).toBe(false);
    expect(moduloVe(USER_SDR, CONV_FU)).toBe(false);
    // e, para ela, o módulo = a policy em TODAS as conversas
    for (const c of [...CONVERSAS, CONV_FU]) {
      const pc = countAs(USER_SDR, `select count(*) from public.conversations where id = '${c}';`) === 1;
      expect(moduloVe(USER_SDR, c)).toBe(pc);
    }
  });

  it("o aviso SEM referência vai à gerência ATIVA: o admin revogado e o pendente NÃO recebem", () => {
    const ids = new Set(sql(`${comParametros(SQL_GERENCIA, [GOV_ORG])};`).split("\n").filter(Boolean));
    expect(ids.has(GOV_ADMIN)).toBe(true);
    expect(ids.has(GOV_MANAGER)).toBe(true);
    expect(ids.has(USER_REVOGADO)).toBe(false);
    expect(ids.has(USER_PENDENTE)).toBe(false);
    // e só admin/manager: o vendedor e o viewer, nunca
    expect(ids.has(GOV_AGENT_B)).toBe(false);
    expect(ids.has(GOV_VIEWER)).toBe(false);
  });

  it("a conexão volta ao pool LIMPA (Lupa 183222): o papel e as claims de antes, inclusive depois de um ERRO no meio", () => {
    // a mesma sequência do módulo, com um erro forçado depois das claims; o \set ON_ERROR_STOP do harness é desligado só
    // aqui, para a sessão seguir depois do erro, como o pool do app (o módulo dá rollback no finally).
    const out = sql(`
      \\set ON_ERROR_STOP 0
      begin;
      ${SQL_PRAZO};
      ${SQL_ASSUMIR_PAPEL};
      ${comParametros(SQL_CLAIMS, [claimsDe(GOV_AGENT_A), GOV_AGENT_A])};
      select 1/0;
      rollback;
      select current_user || '|' || coalesce(current_setting('request.jwt.claims', true), '');
    `);
    expect(lastLine(out)).toBe("postgres|");
  });
});
