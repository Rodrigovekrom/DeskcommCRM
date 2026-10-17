/**
 * ia.vek v1.7 — migration 0579: SDR guardião do lead e notificações pessoais.
 *
 * Mede, no banco real (baseline aplicado), as quatro promessas da entrega:
 *
 *   1. PASSAGEM: a conversa que sai do SDR para o vendedor leva o lead junto;
 *      o vendedor vira dono e o SDR vira guardião (`sdr_user_id`). Quem passa
 *      sem ser SDR não vira guardião.
 *   2. VISIBILIDADE: no modo padrão (`own_and_unassigned`), o guardião continua
 *      vendo o lead e a conversa; um colega qualquer, não.
 *   3. AVISOS: o vendedor é avisado do lead passado; o guardião, de etapa,
 *      perda e tarefa vencida — e nunca do que ele mesmo fez.
 *   4. SINO PRIVADO: cada um lê só as próprias notificações, só marca como lida
 *      e não cria nenhuma; outra organização não vê nada.
 *
 * As duas pontas de cada par são medidas: "o guardião vê" sozinho passaria com
 * uma policy aberta; "o colega não vê" sozinho passaria com uma tabela vazia.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const ORG = "05790000-0000-4000-8000-000000000001";
const OUTRA_ORG = "05790000-0000-4000-8000-000000000002";
const SDR = "05790000-1111-4000-8000-000000000001";
const VENDEDOR = "05790000-1111-4000-8000-000000000002";
const COLEGA = "05790000-1111-4000-8000-000000000003";
const GERENTE = "05790000-1111-4000-8000-000000000004";
const DE_FORA = "05790000-1111-4000-8000-000000000005";
const SESSAO = "05790000-2222-4000-8000-000000000001";
const CONTATO = "05790000-3333-4000-8000-000000000001";
const CONVERSA = "05790000-4444-4000-8000-000000000001";
const FUNIL = "05790000-5555-4000-8000-000000000001";
const ETAPA_1 = "05790000-6666-4000-8000-000000000001";
const ETAPA_2 = "05790000-6666-4000-8000-000000000002";
const LEAD = "05790000-7777-4000-8000-000000000001";
const LEAD_SEM_SDR = "05790000-7777-4000-8000-000000000002";
const CONTATO_2 = "05790000-3333-4000-8000-000000000002";
const TAREFA = "05790000-8888-4000-8000-000000000001";

function comoMembro(userId: string): string {
  return `set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);`;
}

/** Faz a ação como se `ator` estivesse logado, mas com o poder do servidor. */
function agindoComo(ator: string, comando: string): string {
  return sql(`select set_config('request.jwt.claims', '{"sub":"${ator}"}', false);\n${comando};`);
}

function numero(saida: string): number {
  const ultima = saida.trim().split("\n").at(-1) ?? "";
  if (!/^-?\d+$/.test(ultima)) throw new Error(`saída inesperada do psql: ${saida}`);
  return Number(ultima);
}

function contaComo(userId: string, consulta: string): number {
  return numero(sql(`${comoMembro(userId)}\n${consulta};`));
}

function valor(consulta: string): string {
  return sql(`${consulta};`).trim().split("\n").at(-1) ?? "";
}

function notificacoes(userId: string, tipo: string): number {
  return numero(
    sql(`select count(*) from public.notificacoes
          where organization_id = '${ORG}' and user_id = '${userId}' and tipo = '${tipo}';`),
  );
}

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values
      ('${SDR}', 'g0579-sdr@invariant.test'),
      ('${VENDEDOR}', 'g0579-vendedor@invariant.test'),
      ('${COLEGA}', 'g0579-colega@invariant.test'),
      ('${GERENTE}', 'g0579-gerente@invariant.test'),
      ('${DE_FORA}', 'g0579-fora@invariant.test')
      on conflict do nothing;

    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'g0579', 'Guardiao 0579', 'Guardiao 0579'),
             ('${OUTRA_ORG}', 'g0579-outra', 'Guardiao 0579 Outra', 'Outra')
      on conflict (id) do nothing;

    insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings) values
      ('${SDR}',      '${ORG}', 'agent',   now(), '{"preset":"completa","funcao":"sdr"}'),
      ('${VENDEDOR}', '${ORG}', 'agent',   now(), '{"preset":"completa","funcao":"vendedor"}'),
      ('${COLEGA}',   '${ORG}', 'agent',   now(), '{"preset":"completa","funcao":"vendedor"}'),
      ('${GERENTE}',  '${ORG}', 'manager', now(), '{"preset":"completa","funcao":"gerente"}'),
      ('${DE_FORA}',  '${OUTRA_ORG}', 'admin', now(), '{"preset":"completa"}')
      on conflict do nothing;

    do $seed$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'g0579', '\\x00'::bytea);
    exception when unique_violation then null; end $seed$;

    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO}', '${ORG}', 'Cliente 0579'),
      ('${CONTATO_2}', '${ORG}', 'Cliente 0579 B')
      on conflict do nothing;

    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${FUNIL}', '${ORG}', 'Funil 0579', 'g0579-funil')
      on conflict do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${ETAPA_1}', '${ORG}', '${FUNIL}', 'Novo', 'novo', 1000),
      ('${ETAPA_2}', '${ORG}', '${FUNIL}', 'Agendado', 'agendado', 2000)
      on conflict do nothing;

    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id)
      values ('${LEAD}', '${ORG}', '${FUNIL}', '${ETAPA_1}', 'Lead 0579', '${CONTATO}'),
             ('${LEAD_SEM_SDR}', '${ORG}', '${FUNIL}', '${ETAPA_1}', 'Lead 0579 B', '${CONTATO_2}')
      on conflict do nothing;

    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open')
      on conflict do nothing;
  `);

  // O SDR assume a conversa (vinda da IA, sem dono)…
  agindoComo(
    SDR,
    `update public.conversations set assigned_to_user_id = '${SDR}' where id = '${CONVERSA}'`,
  );
  // …e passa para o vendedor.
  agindoComo(
    SDR,
    `update public.conversations set assigned_to_user_id = '${VENDEDOR}' where id = '${CONVERSA}'`,
  );
});

describe("passagem SDR → vendedor", () => {
  it("o lead vai junto com a conversa: o vendedor é o dono e o SDR o guardião", () => {
    expect(valor(`select owner_user_id from public.crm_leads where id = '${LEAD}'`)).toBe(VENDEDOR);
    expect(valor(`select owner_kind from public.crm_leads where id = '${LEAD}'`)).toBe("user");
    expect(valor(`select sdr_user_id from public.crm_leads where id = '${LEAD}'`)).toBe(SDR);
  });

  it("quem passa sem ser SDR não vira guardião", () => {
    agindoComo(
      VENDEDOR,
      `update public.crm_leads set owner_user_id = '${VENDEDOR}', owner_kind = 'user' where id = '${LEAD_SEM_SDR}'`,
    );
    agindoComo(
      VENDEDOR,
      `update public.crm_leads set owner_user_id = '${COLEGA}' where id = '${LEAD_SEM_SDR}'`,
    );
    expect(
      valor(
        `select coalesce(sdr_user_id::text, 'nenhum') from public.crm_leads where id = '${LEAD_SEM_SDR}'`,
      ),
    ).toBe("nenhum");
  });
});

describe("o clone do lead (esteira, troca de funil) herda o guardião", () => {
  it("lead criado com source_metadata.clonado_de nasce com o mesmo sdr_user_id", () => {
    const CLONE = "05790000-7777-4000-8000-000000000009";
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, source_metadata)
           values ('${CLONE}', '${ORG}', '${FUNIL}', '${ETAPA_1}', 'Clone 0579', '${CONTATO}',
                   jsonb_build_object('clonado_de', jsonb_build_object('lead_id', '${LEAD}')))
           on conflict do nothing;`);
    expect(valor(`select sdr_user_id from public.crm_leads where id = '${CLONE}'`)).toBe(SDR);
  });
});

describe("o guardião continua vendo (modo padrão own_and_unassigned)", () => {
  it("o SDR guardião vê o lead e a conversa; o colega não", () => {
    const lead = `select count(*) from public.crm_leads where id = '${LEAD}'`;
    const conversa = `select count(*) from public.conversations where id = '${CONVERSA}'`;
    expect(contaComo(SDR, lead)).toBe(1);
    expect(contaComo(SDR, conversa)).toBe(1);
    expect(contaComo(COLEGA, lead)).toBe(0);
    expect(contaComo(COLEGA, conversa)).toBe(0);
    expect(contaComo(VENDEDOR, lead)).toBe(1);
  });
});

describe("avisos", () => {
  it("o vendedor é avisado do lead passado; o SDR não é avisado do que ele mesmo fez", () => {
    expect(notificacoes(VENDEDOR, "lead_passado")).toBeGreaterThanOrEqual(1);
    expect(notificacoes(SDR, "lead_passado")).toBe(0);
  });

  it("o guardião fica sabendo da mudança de etapa e da perda feitas pelo vendedor", () => {
    agindoComo(
      VENDEDOR,
      `update public.crm_leads set stage_id = '${ETAPA_2}' where id = '${LEAD}'`,
    );
    expect(notificacoes(SDR, "guardiao_etapa")).toBe(1);
    expect(
      valor(
        `select dados->>'para' from public.notificacoes where user_id = '${SDR}' and tipo = 'guardiao_etapa'`,
      ),
    ).toBe("Agendado");

    agindoComo(SDR, `update public.crm_leads set stage_id = '${ETAPA_1}' where id = '${LEAD}'`);
    expect(notificacoes(SDR, "guardiao_etapa")).toBe(1); // o que ele mesmo fez não vira aviso

    agindoComo(
      VENDEDOR,
      `update public.crm_leads set status = 'lost', lost_reason = 'price', closed_at = now() where id = '${LEAD}'`,
    );
    expect(notificacoes(SDR, "guardiao_perda")).toBe(1);
  });

  it("tarefa vencida avisa o responsável e o guardião", () => {
    sql(`
      insert into public.crm_tasks (id, organization_id, title, lead_id, assigned_to, due_date, status)
        values ('${TAREFA}', '${ORG}', 'Ligar', '${LEAD}', '${VENDEDOR}', now() - interval '1 hour', 'pending')
        on conflict do nothing;
      insert into public.event_log (organization_id, event_type, entity_kind, entity_id, payload)
        values ('${ORG}', 'task.overdue', 'crm_task', '${TAREFA}', '{}'::jsonb);
    `);
    expect(notificacoes(VENDEDOR, "tarefa_vencida")).toBe(1);
    expect(notificacoes(SDR, "guardiao_tarefa_vencida")).toBe(1);
  });
});

describe("sino privado", () => {
  it("cada um lê só as próprias notificações", () => {
    const minhas = `select count(*) from public.notificacoes where organization_id = '${ORG}'`;
    const doSdr = numero(sql(`select count(*) from public.notificacoes where user_id = '${SDR}';`));
    expect(doSdr).toBeGreaterThan(0);
    expect(contaComo(SDR, minhas)).toBe(doSdr);
    expect(
      contaComo(COLEGA, `select count(*) from public.notificacoes where user_id = '${SDR}'`),
    ).toBe(0);
    expect(
      contaComo(GERENTE, `select count(*) from public.notificacoes where user_id = '${SDR}'`),
    ).toBe(0);
    expect(contaComo(DE_FORA, minhas)).toBe(0);
  });

  it("marca como lida, mas não muda o tipo nem cria notificação", () => {
    const marcar = sql(`${comoMembro(SDR)}
      update public.notificacoes set lida_em = now() where user_id = '${SDR}' and lida_em is null;
      select count(*) from public.notificacoes where user_id = '${SDR}' and lida_em is null;`);
    expect(numero(marcar)).toBe(0);
    expect(() =>
      sql(`${comoMembro(SDR)}
        update public.notificacoes set tipo = 'lead_passado' where user_id = '${SDR}';`),
    ).toThrow();
    expect(() =>
      sql(`${comoMembro(SDR)}
        insert into public.notificacoes (organization_id, user_id, tipo) values ('${ORG}', '${SDR}', 'lead_passado');`),
    ).toThrow();
  });
});
