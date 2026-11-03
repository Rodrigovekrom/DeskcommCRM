import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_MANAGER, GOV_ORG, GOV_SESSION, lastLine, seedGov, sql } from "./gov-helpers";

/** ia.vek v1.9.13 (0601): desligado por padrão, quem orienta, o que a orientação faz e o sino. */
const N = "eeeeeeee-0601-4000-8000-000000000";
const CONTATO = `${N}001`;
const CONVERSA = `${N}002`;

const como = (uid: string, s: string) =>
  sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false); ${s}`);
const orientar = (uid: string, texto: string) =>
  como(uid, `select public.fn_iavek_orientar_ia('${GOV_ORG}', '${CONVERSA}', '${texto}');`);
const ligar = (v: boolean) =>
  sql(`update public.organizations set settings = jsonb_set(coalesce(settings,'{}'), '{iavek}',
       coalesce(settings->'iavek','{}') || jsonb_build_object('canal_orientacao_ia', jsonb_build_object('ativo', ${v}))) where id='${GOV_ORG}';`);
const funcao = (uid: string, f: string | null) =>
  sql(`update public.user_organizations set interface_settings = coalesce(interface_settings,'{}') ||
       ${f ? `'{"funcao":"${f}"}'` : `'{"funcao":null}'`} where organization_id='${GOV_ORG}' and user_id='${uid}';`);
const avisos = (extra = "") =>
  Number(lastLine(sql(`select count(*) from public.notificacoes where organization_id='${GOV_ORG}' and tipo='ia_travou' ${extra};`)));

describe("0601 — o canal de orientação da IA", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      insert into public.contacts (id, organization_id, display_name) values ('${CONTATO}', '${GOV_ORG}', 'Contato 0601') on conflict (id) do nothing;
      insert into public.conversations (id, organization_id, contact_id, channel_session_id, status)
        values ('${CONVERSA}', '${GOV_ORG}', '${CONTATO}', '${GOV_SESSION}', 'open') on conflict (id) do nothing;
    `);
  });

  it("desligado: ninguém orienta, e a Central não vira sino", () => {
    expect(() => orientar(GOV_MANAGER, "x")).toThrow(/canal_desligado/);
    sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
         values ('${GOV_ORG}', 'capabilities_missing', 'critical', 't', 'b', 'conversation', '${CONVERSA}');`);
    expect(avisos()).toBe(0);
  });

  it("ligado: agente comum não orienta; Suporte IA e gerente sim", () => {
    ligar(true);
    funcao(GOV_AGENT_A, null);
    expect(() => orientar(GOV_AGENT_A, "x")).toThrow(/orientacao_sem_permissao/);
    funcao(GOV_AGENT_A, "suporte");
    orientar(GOV_AGENT_A, "ofereça o Onix");
    orientar(GOV_MANAGER, "fale do financiamento");
    expect(lastLine(sql(`select count(*) from public.iavek_orientacoes_da_ia where conversation_id='${CONVERSA}';`))).toBe("2");
  });

  it("orientar invalida a sugestão atual (a conversa mudou)", () => {
    const antes = Number(lastLine(sql(`select reply_context_revision from public.conversations where id='${CONVERSA}';`)));
    orientar(GOV_AGENT_A, "mais uma");
    expect(Number(lastLine(sql(`select reply_context_revision from public.conversations where id='${CONVERSA}';`)))).toBe(antes + 1);
  });

  it("quem lê: a autora a dela, gerente todas; sessão não grava direto", () => {
    expect(lastLine(como(GOV_AGENT_A, `select count(*) from public.iavek_orientacoes_da_ia where conversation_id='${CONVERSA}';`))).toBe("2");
    expect(lastLine(como(GOV_MANAGER, `select count(*) from public.iavek_orientacoes_da_ia where conversation_id='${CONVERSA}';`))).toBe("3");
    expect(() => como(GOV_AGENT_A, `insert into public.iavek_orientacoes_da_ia (organization_id, conversation_id, contact_id, texto) values ('${GOV_ORG}','${CONVERSA}','${CONTATO}','x');`)).toThrow(/permission denied/);
  });

  it("a revisão é de gerente", () => {
    const id = lastLine(sql(`select id from public.iavek_orientacoes_da_ia where conversation_id='${CONVERSA}' limit 1;`));
    expect(() => como(GOV_AGENT_A, `select public.fn_iavek_revisar_orientacao('${GOV_ORG}', '${id}', 'virou_regra');`)).toThrow(/orientacao_sem_permissao/);
    como(GOV_MANAGER, `select public.fn_iavek_revisar_orientacao('${GOV_ORG}', '${id}', 'virou_regra');`);
    expect(lastLine(sql(`select revisao from public.iavek_orientacoes_da_ia where id='${id}';`))).toBe("virou_regra");
  });

  it("o sino: vai à Suporte IA, com o motivo; não repete enquanto não for lido; outro motivo avisa", () => {
    const insere = (k: string) => sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
      values ('${GOV_ORG}', '${k}', 'critical', 'Motivo de ${k}', 'b', 'conversation', '${CONVERSA}');`);
    insere("capabilities_missing");
    insere("capabilities_missing");
    expect(avisos(`and user_id='${GOV_AGENT_A}'`)).toBe(1);
    expect(avisos(`and user_id<>'${GOV_AGENT_A}'`)).toBe(0);
    expect(lastLine(sql(`select dados->>'motivo' from public.notificacoes where tipo='ia_travou' and organization_id='${GOV_ORG}' limit 1;`))).toBe("Motivo de capabilities_missing");
    insere("message_send_stuck");
    expect(avisos(`and user_id='${GOV_AGENT_A}'`)).toBe(2);
  });

  it("LGPD: anonimizar zera o texto da orientação", () => {
    const C2 = `${N}011`; const V2 = `${N}012`;
    sql(`insert into public.contacts (id, organization_id, display_name) values ('${C2}', '${GOV_ORG}', 'Contato 0601 B') on conflict (id) do nothing;
         insert into public.conversations (id, organization_id, contact_id, channel_session_id, status) values ('${V2}', '${GOV_ORG}', '${C2}', '${GOV_SESSION}', 'open') on conflict (id) do nothing;
         insert into public.iavek_orientacoes_da_ia (organization_id, conversation_id, contact_id, texto) values ('${GOV_ORG}', '${V2}', '${C2}', 'cita o cliente');`);
    sql(`update public.contacts set is_anonymized = true, anonymized_at = now() where id='${C2}';`);
    expect(lastLine(sql(`select texto from public.iavek_orientacoes_da_ia where contact_id='${C2}';`))).toBe("[redigido]");
  });

  it("sem ninguém no Suporte IA, os admins; e kind de fora não avisa", () => {
    funcao(GOV_AGENT_A, null);
    sql(`delete from public.notificacoes where tipo='ia_travou' and organization_id='${GOV_ORG}';`);
    sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
      values ('${GOV_ORG}', 'capabilities_missing', 'critical', 'M', 'b', 'conversation', '${CONVERSA}');`);
    const admins = Number(lastLine(sql(`select count(*) from public.user_organizations where organization_id='${GOV_ORG}' and role='admin' and revoked_at is null and accepted_at is not null;`)));
    expect(avisos()).toBe(admins);
    sql(`delete from public.notificacoes where tipo='ia_travou' and organization_id='${GOV_ORG}';`);
    sql(`insert into public.agent_inbox_items (organization_id, kind, severity, title, body, ref_kind, ref_id)
      values ('${GOV_ORG}', 'other', 'info', 'M', 'b', 'conversation', '${CONVERSA}');`);
    expect(avisos()).toBe(0);
    ligar(false);
  });
});
