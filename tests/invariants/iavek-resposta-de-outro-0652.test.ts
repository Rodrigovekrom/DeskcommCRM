/**
 * ia.vek CRM-434 (migration 0652): "fulano respondeu o seu cliente" no sino do DONO do lead.
 *
 * O que só o Postgres prova (desenho D3, verde da Lupa 130008 com as condições 1 a 3):
 *   - dispara para o gerente e para o admin ATIVOS; nunca para o agente, o revogado, o próprio dono nem o guardião
 *     (sdr_user_id), mesmo gerente;
 *   - nunca em conversa de grupo, mensagem da IA ou do cliente;
 *   - sem lead aberto, lead sem dono, dono revogado ou empate: SILÊNCIO, e a mensagem é gravada;
 *   - o lead ativo é o do app (condição 1): o do funil padrão; senão o de maior coalesce(last_activity_at,
 *     created_at); o funil padrão ARQUIVADO não conta;
 *   - a janela de 10 min por conversa e dono (condição 3);
 *   - o gatilho NUNCA derruba a mensagem (condição 2): com o insert do aviso quebrado de propósito, a mensagem fica;
 *   - quem não é membro da org nunca dispara aviso nela;
 *   - o check do sino mantém as 23 de antes e aceita o tipo novo.
 * Cada arquivo roda num banco próprio (scripts/test-db.sh).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG = "a5340652-0000-4000-8000-00000000000a";
const ORG_B = "a5340652-0000-4000-8000-00000000000b";
const id = (grupo: number, n: number) =>
  `a5340652-${String(grupo).padStart(4, "0")}-4000-8000-${String(n).padStart(12, "0")}`;

// pessoas (grupo 1)
const DONO = id(1, 1);
const GERENTE = id(1, 2);
const ADMIN = id(1, 3);
const AGENTE = id(1, 4);
const GUARDIAO_GERENTE = id(1, 5);
const DONO_GERENTE = id(1, 6);
const GERENTE_REVOGADO = id(1, 7);
const DONO_REVOGADO = id(1, 8);
const GERENTE_B = id(1, 9);
const DONO_B = id(1, 10);

const SESSAO = id(2, 1);
const SESSAO_B = id(2, 2);
const P_PADRAO = id(3, 1);
const P_OUTRO = id(3, 2);
const P_B_PADRAO_ARQUIVADO = id(3, 3);
const P_B_OUTRO = id(3, 4);
const ETAPA = (p: string) => p.replace("-0003-", "-0004-");

/** Um cenário = um contato, uma conversa e os leads dele. */
interface Cenario {
  contato: string;
  conversa: string;
}
const cenario = (n: number): Cenario => ({ contato: id(5, n), conversa: id(6, n) });
const C = {
  base: cenario(1),
  admin: cenario(2),
  agente: cenario(3),
  guardiao: cenario(4),
  dono: cenario(5),
  revogado: cenario(6),
  grupo: cenario(7),
  semAberto: cenario(8),
  semDono: cenario(9),
  donoRevogado: cenario(10),
  padrao: cenario(11),
  empate: cenario(12),
  semAtividade: cenario(13),
  quebrado: cenario(14),
  iaECliente: cenario(15),
};
const B = {
  arquivado: { contato: id(5, 50), conversa: id(6, 50) },
  intruso: { contato: id(5, 51), conversa: id(6, 51) },
};

const L = (n: number) => id(7, n);

function membro(user: string, org: string, role: string, funcao: string, revogado = false): string {
  return `insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at, interface_settings)
    values ('${user}', '${org}', '${role}', now(), ${revogado ? "now()" : "null"}, '{"preset":"completa","funcao":"${funcao}"}'::jsonb)
    on conflict do nothing;`;
}

function conversa(org: string, sessao: string, c: Cenario, grupo = false): string {
  return `insert into public.contacts (id, organization_id, display_name) values ('${c.contato}', '${org}', 'Cliente 0652') on conflict do nothing;
    insert into public.conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
      values ('${c.conversa}', '${org}', '${c.contato}', '${sessao}', 'open', ${grupo}) on conflict do nothing;`;
}

function lead(a: {
  id: string;
  org?: string;
  pipeline: string;
  c: Cenario;
  dono: string | null;
  sdr?: string | null;
  status?: string;
  atividade?: string | null;
  criado?: string;
}): string {
  const q = (v: string | null | undefined) => (v ? `'${v}'` : "null");
  return `insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, owner_user_id, sdr_user_id,
      status, closed_at, last_activity_at, created_at)
    values ('${a.id}', '${a.org ?? ORG}', '${a.pipeline}', '${ETAPA(a.pipeline)}', 'Lead 0652', '${a.c.contato}', ${q(a.dono)},
      ${q(a.sdr)}, '${a.status ?? "open"}', ${(a.status ?? "open") === "open" ? "null" : "now()"},
      ${q(a.atividade === undefined ? "2026-11-20T10:00:00Z" : a.atividade)},
      '${a.criado ?? "2026-11-01T10:00:00Z"}');`;
}

/** Uma mensagem de SAÍDA escrita por uma pessoa (ou não, com `via`/`direcao`). */
function mensagem(
  c: Cenario,
  autor: string | null,
  opts: { org?: string; sessao?: string; via?: string; direcao?: string } = {},
): string {
  return `insert into public.messages (organization_id, conversation_id, channel_session_id, contact_id, type, direction, status,
      sent_via, sent_by_user_id, body, sent_at)
    values ('${opts.org ?? ORG}', '${c.conversa}', '${opts.sessao ?? SESSAO}', '${c.contato}', 'text', '${opts.direcao ?? "outbound"}',
      'sent', '${opts.via ?? "user"}', ${autor ? `'${autor}'` : "null"}, 'texto do teste', now());`;
}

function numero(script: string): number {
  return Number(sql(script).split("\n").pop());
}

const avisos = (c: Cenario, para?: string) =>
  numero(`select count(*) from public.notificacoes where tipo = 'resposta_de_outro'
    and dados->>'conversation_id' = '${c.conversa}' ${para ? `and user_id = '${para}'` : ""};`);
const mensagens = (c: Cenario) =>
  numero(`select count(*) from public.messages where conversation_id = '${c.conversa}';`);

beforeAll(() => {
  const pessoas = [
    DONO,
    GERENTE,
    ADMIN,
    AGENTE,
    GUARDIAO_GERENTE,
    DONO_GERENTE,
    GERENTE_REVOGADO,
    DONO_REVOGADO,
    GERENTE_B,
    DONO_B,
  ];
  sql(`
    ${pessoas.map((p, i) => `insert into auth.users (id, email) values ('${p}', 'c434-${i}@invariant.test') on conflict do nothing;`).join("\n")}
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'c434-a', 'Org A 0652', 'A'), ('${ORG_B}', 'c434-b', 'Org B 0652', 'B') on conflict do nothing;
    ${membro(DONO, ORG, "agent", "vendedor")}
    ${membro(GERENTE, ORG, "manager", "gerente")}
    ${membro(ADMIN, ORG, "admin", "gerente")}
    ${membro(AGENTE, ORG, "agent", "vendedor")}
    ${membro(GUARDIAO_GERENTE, ORG, "manager", "sdr")}
    ${membro(DONO_GERENTE, ORG, "manager", "gerente")}
    ${membro(GERENTE_REVOGADO, ORG, "manager", "gerente", true)}
    ${membro(DONO_REVOGADO, ORG, "agent", "vendedor")}
    ${membro(GERENTE_B, ORG_B, "manager", "gerente")}
    ${membro(DONO_B, ORG_B, "agent", "vendedor")}
    do $s$ begin
      insert into public.channel_sessions (id, organization_id, waha_session_name, webhook_secret_encrypted)
        values ('${SESSAO}', '${ORG}', 'c434-a', '\\x00'::bytea), ('${SESSAO_B}', '${ORG_B}', 'c434-b', '\\x00'::bytea);
    exception when unique_violation then null; end $s$;
    -- a org nasce com um funil padrão (trg_seed_default_pipeline_for_org) e só pode haver 1 padrão por org: o semeado
    -- deixa de ser padrão, e os deste teste entram sem "on conflict" (falham alto).
    update public.crm_pipelines set is_default = false where organization_id in ('${ORG}', '${ORG_B}');
    insert into public.crm_pipelines (id, organization_id, name, slug, is_default, is_archived) values
      ('${P_PADRAO}', '${ORG}', 'Padrão', 'c434-padrao', true, false),
      ('${P_OUTRO}', '${ORG}', 'Outro', 'c434-outro', false, false),
      ('${P_B_PADRAO_ARQUIVADO}', '${ORG_B}', 'Padrão arquivado', 'c434-b-padrao', true, true),
      ('${P_B_OUTRO}', '${ORG_B}', 'Outro B', 'c434-b-outro', false, false);
    ${[P_PADRAO, P_OUTRO, P_B_PADRAO_ARQUIVADO, P_B_OUTRO]
      .map(
        (
          p,
        ) => `insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
          values ('${ETAPA(p)}', (select organization_id from public.crm_pipelines where id = '${p}'), '${p}', 'Novo', 'novo', 1000)
          on conflict do nothing;`,
      )
      .join("\n")}
    ${Object.values(C)
      .map((c) => conversa(ORG, SESSAO, c, c === C.grupo))
      .join("\n")}
    ${conversa(ORG_B, SESSAO_B, B.arquivado)}
    ${conversa(ORG_B, SESSAO_B, B.intruso)}
    ${lead({ id: L(1), pipeline: P_PADRAO, c: C.base, dono: DONO })}
    ${lead({ id: L(2), pipeline: P_PADRAO, c: C.admin, dono: DONO })}
    ${lead({ id: L(3), pipeline: P_PADRAO, c: C.agente, dono: DONO })}
    ${lead({ id: L(4), pipeline: P_PADRAO, c: C.guardiao, dono: DONO, sdr: GUARDIAO_GERENTE })}
    ${lead({ id: L(5), pipeline: P_PADRAO, c: C.dono, dono: DONO_GERENTE })}
    ${lead({ id: L(6), pipeline: P_PADRAO, c: C.revogado, dono: DONO })}
    ${lead({ id: L(7), pipeline: P_PADRAO, c: C.grupo, dono: DONO })}
    ${lead({ id: L(8), pipeline: P_PADRAO, c: C.semAberto, dono: DONO, status: "won" })}
    ${lead({ id: L(9), pipeline: P_PADRAO, c: C.semDono, dono: null })}
    ${lead({ id: L(10), pipeline: P_PADRAO, c: C.donoRevogado, dono: DONO_REVOGADO })}
    ${lead({ id: L(11), pipeline: P_OUTRO, c: C.padrao, dono: AGENTE, atividade: "2026-11-22T10:00:00Z" })}
    ${lead({ id: L(12), pipeline: P_PADRAO, c: C.padrao, dono: DONO, atividade: "2026-11-01T10:00:00Z" })}
    ${lead({ id: L(13), pipeline: P_OUTRO, c: C.empate, dono: DONO, atividade: "2026-11-20T10:00:00Z" })}
    ${lead({ id: L(14), pipeline: P_OUTRO, c: C.empate, dono: AGENTE, atividade: "2026-11-20T10:00:00Z" })}
    ${lead({ id: L(15), pipeline: P_OUTRO, c: C.semAtividade, dono: DONO, atividade: null, criado: "2026-11-22T10:00:00Z" })}
    ${lead({ id: L(16), pipeline: P_OUTRO, c: C.semAtividade, dono: AGENTE, atividade: "2026-11-21T10:00:00Z" })}
    ${lead({ id: L(17), pipeline: P_PADRAO, c: C.quebrado, dono: DONO })}
    ${lead({ id: L(18), pipeline: P_PADRAO, c: C.iaECliente, dono: DONO })}
    ${lead({ id: L(50), org: ORG_B, pipeline: P_B_PADRAO_ARQUIVADO, c: B.arquivado, dono: GERENTE_B, atividade: "2026-11-01T10:00:00Z" })}
    ${lead({ id: L(51), org: ORG_B, pipeline: P_B_OUTRO, c: B.arquivado, dono: DONO_B, atividade: "2026-11-22T10:00:00Z" })}
    ${lead({ id: L(52), org: ORG_B, pipeline: P_B_OUTRO, c: B.intruso, dono: DONO_B })}
    -- o dono só pode ser posto num lead enquanto ativo (0403); a saída da loja vem DEPOIS, como na vida real.
    update public.user_organizations set revoked_at = now() where user_id = '${DONO_REVOGADO}' and organization_id = '${ORG}';
  `);
});

describe("0652: quem dispara", () => {
  it("o gerente responde: 1 aviso ao DONO, com o lead, quem respondeu e a conversa, sem o texto", () => {
    sql(mensagem(C.base, GERENTE));
    const linha =
      sql(`select user_id || '|' || lead_id || '|' || ator_user_id || '|' || (dados ? 'body')::text || '|' || jsonb_object_keys(dados)
      from public.notificacoes where tipo = 'resposta_de_outro' and dados->>'conversation_id' = '${C.base.conversa}';`);
    expect(linha).toBe(`${DONO}|${L(1)}|${GERENTE}|false|conversation_id`);
  });

  it("o admin também dispara", () => {
    sql(mensagem(C.admin, ADMIN));
    expect(avisos(C.admin, DONO)).toBe(1);
  });

  it("nunca: o agente, o guardião (mesmo gerente), o próprio dono (mesmo gerente) e o gerente revogado", () => {
    sql(mensagem(C.agente, AGENTE));
    sql(mensagem(C.guardiao, GUARDIAO_GERENTE));
    sql(mensagem(C.dono, DONO_GERENTE));
    sql(mensagem(C.revogado, GERENTE_REVOGADO));
    for (const c of [C.agente, C.guardiao, C.dono, C.revogado]) {
      expect(avisos(c)).toBe(0);
      expect(mensagens(c)).toBe(1);
    }
  });

  it("nunca: conversa de grupo, mensagem da IA nem do cliente", () => {
    sql(mensagem(C.grupo, GERENTE));
    sql(mensagem(C.iaECliente, null, { via: "ai" }));
    sql(mensagem(C.iaECliente, null, { via: "ai", direcao: "inbound" }));
    expect(avisos(C.grupo)).toBe(0);
    expect(avisos(C.iaECliente)).toBe(0);
    expect(mensagens(C.grupo)).toBe(1);
  });

  it("quem não é membro da org nunca dispara nela", () => {
    sql(mensagem(B.intruso, GERENTE, { org: ORG_B, sessao: SESSAO_B }));
    expect(avisos(B.intruso)).toBe(0);
  });
});

describe("0652: sem destinatário é SILÊNCIO, e a mensagem fica", () => {
  it("sem lead aberto, lead sem dono e dono revogado", () => {
    for (const c of [C.semAberto, C.semDono, C.donoRevogado]) {
      sql(mensagem(c, GERENTE));
      expect(avisos(c)).toBe(0);
      expect(mensagens(c)).toBe(1);
    }
  });
});

describe("0652: o lead ativo é o do app (condição 1)", () => {
  it("2 abertos: vale o do funil padrão, mesmo mais antigo", () => {
    sql(mensagem(C.padrao, GERENTE));
    expect(avisos(C.padrao, DONO)).toBe(1);
    expect(avisos(C.padrao, AGENTE)).toBe(0);
  });

  it("empate no topo da atividade: ambíguo, ninguém é avisado", () => {
    sql(mensagem(C.empate, GERENTE));
    expect(avisos(C.empate)).toBe(0);
  });

  it("last_activity_at nulo cai no created_at", () => {
    sql(mensagem(C.semAtividade, GERENTE));
    expect(avisos(C.semAtividade, DONO)).toBe(1);
    expect(avisos(C.semAtividade, AGENTE)).toBe(0);
  });

  it("o funil padrão ARQUIVADO não conta: vale o de maior atividade", () => {
    sql(mensagem(B.arquivado, GERENTE_B, { org: ORG_B, sessao: SESSAO_B }));
    expect(avisos(B.arquivado, DONO_B)).toBe(1);
    expect(avisos(B.arquivado, GERENTE_B)).toBe(0);
  });
});

describe("0652: a janela de 10 min (condição 3)", () => {
  it("2 respostas seguidas dão 1 aviso; com o aviso recuado 11 min, a próxima dá outro", () => {
    sql(mensagem(C.base, GERENTE));
    sql(mensagem(C.base, ADMIN));
    expect(avisos(C.base, DONO)).toBe(1);
    sql(`update public.notificacoes set created_at = now() - interval '11 minutes'
      where tipo = 'resposta_de_outro' and dados->>'conversation_id' = '${C.base.conversa}';`);
    sql(mensagem(C.base, GERENTE));
    expect(avisos(C.base, DONO)).toBe(2);
  });
});

describe("0652: o gatilho nunca derruba a mensagem (condição 2)", () => {
  it("com o insert do aviso quebrado de propósito, a mensagem é gravada e nenhum aviso aparece", () => {
    const out = sql(`begin;
      alter table public.notificacoes drop constraint notificacoes_tipo_check;
      alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in ('lead_passado')) not valid;
      ${mensagem(C.quebrado, GERENTE)}
      select count(*) from public.messages where conversation_id = '${C.quebrado.conversa}';
      rollback;`);
    // o psql imprime as etiquetas (BEGIN, INSERT 0 1, ROLLBACK): a contagem é a única linha só de dígitos.
    expect(out.split("\n").filter((l) => /^\d+$/.test(l))).toEqual(["1"]);
    expect(avisos(C.quebrado)).toBe(0);
  });
});

describe("0652: o check do sino", () => {
  it("mantém as 23 de antes e aceita o tipo novo", () => {
    const def = sql(
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notificacoes_tipo_check';`,
    );
    const tipos = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
    expect(tipos).toHaveLength(24);
    for (const t of [
      "lead_passado",
      "aviso_da_loja",
      "agendamento_no_seu_lead",
      "orientacao_da_loja",
      "novidade_da_versao",
      "resposta_de_outro",
    ]) {
      expect(tipos, t).toContain(t);
    }
  });
});
