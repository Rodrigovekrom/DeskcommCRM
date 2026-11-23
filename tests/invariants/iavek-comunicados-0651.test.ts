/**
 * ia.vek CRM-439 fase 1 (migration 0651): as orientações da loja e as novidades da versão, no BANCO.
 *
 * O que só o Postgres prova (desenho D2, verde da Lupa 113859 com as condições H e I):
 *   - quem recebe: a função (com o 'apoio' como 'gerente'), a pessoa; nunca o revogado, a analista de ficha, quem
 *     enviou nem alguém de outra org (H: a função de envio é definer e confere tudo na mesma org);
 *   - a função de envio é UMA transação: um erro no meio não deixa linha nenhuma;
 *   - a RLS: o vendedor vê o dele e não o da SDR; o gestor e o admin da plataforma veem tudo; a outra org, nada;
 *   - o "li e entendi" (INVOKER): grava o da pessoa e apaga a bolinha do sino; só lê quem é destinatário;
 *   - a LISTA BRANCA: nenhum UPDATE de coluna passa, até para o service_role; nenhum DELETE direto passa;
 *   - apagar a PESSOA funciona (o SET NULL e o CASCADE passam pelas travas) e o comunicado continua (Lupa A);
 *   - apagar a ORG leva a cadeia inteira, inclusive uma cadeia de correções A ← B ← C (Lupa F e I);
 *   - o check do sino mantém todos os tipos de antes e aceita os 2 novos.
 * Cada arquivo roda num banco próprio (scripts/test-db.sh), então as fixtures daqui são só deste arquivo.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { countAs, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const ORG_A = "a5390651-0000-4000-8000-00000000000a";
const ORG_B = "a5390651-0000-4000-8000-00000000000b";
const ORG_C = "a5390651-0000-4000-8000-00000000000c";
const ORG_D = "a5390651-0000-4000-8000-00000000000d";

const u = (n: number) => `a5390651-1111-4000-8000-${String(n).padStart(12, "0")}`;
const GESTOR = u(1);
const APOIO = u(2);
const VEND_1 = u(3);
const VEND_2 = u(4);
const SDR = u(5);
const REVOGADO = u(6);
const ANALISTA = u(7);
const DE_B = u(8);
const GESTOR_B = u(9);
const PLATAFORMA = u(10);
const ENVIA_C = u(11);
const RECEBE_C = u(12);
const OUTRO_C = u(13);
const ENVIA_D = u(14);
const RECEBE_D = u(15);

function membro(user: string, org: string, role: string, funcao: string, revogado = false): string {
  return `insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at, interface_settings)
    values ('${user}', '${org}', '${role}', now(), ${revogado ? "now()" : "null"}, '{"preset":"completa","funcao":"${funcao}"}'::jsonb)
    on conflict do nothing;`;
}

/** Chama a função de envio como o service_role (é só dele) e devolve o id do comunicado. */
function enviar(a: {
  org: string;
  tipo?: "orientacao" | "novidade";
  alvo: "funcao" | "pessoa";
  funcao?: string;
  pessoa?: string;
  por?: string | null;
  substitui?: string;
  versao?: string;
  titulo?: string;
}): string {
  const q = (v: string | null | undefined) => (v ? `'${v}'` : "null");
  const tipo = a.tipo ?? "orientacao";
  const out = sql(`set role service_role;
    select comunicado_id from public.fn_iavek_enviar_comunicado(
      '${a.org}', '${tipo}', '${a.titulo ?? "Título"}', 'Texto da orientação', '${a.alvo}',
      ${q(a.funcao)}, ${q(a.pessoa)}, true, ${q(a.por === undefined ? GESTOR : a.por)}, ${q(a.substitui)}, ${q(a.versao)});`);
  return out.split("\n").pop()!.trim();
}

function falha(script: string): string {
  try {
    sql(script);
  } catch (err) {
    return motivoDoErro(err);
  }
  return "PASSOU";
}

function como(user: string, comando: string): string {
  return `set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${user}"}', false);
    ${comando}`;
}

function numero(script: string): number {
  return Number(sql(script).split("\n").pop());
}

let PARA_VENDEDOR = "";
let PARA_SDR = "";
let PARA_GERENTE = "";

beforeAll(() => {
  const todos = [
    GESTOR,
    APOIO,
    VEND_1,
    VEND_2,
    SDR,
    REVOGADO,
    ANALISTA,
    DE_B,
    GESTOR_B,
    PLATAFORMA,
    ENVIA_C,
    RECEBE_C,
    OUTRO_C,
    ENVIA_D,
    RECEBE_D,
  ];
  sql(`
    ${todos.map((id, i) => `insert into auth.users (id, email) values ('${id}', 'c439-${i}@invariant.test') on conflict do nothing;`).join("\n")}
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'c439-a', 'Org A 0651', 'A'), ('${ORG_B}', 'c439-b', 'Org B 0651', 'B'),
      ('${ORG_C}', 'c439-c', 'Org C 0651', 'C'), ('${ORG_D}', 'c439-d', 'Org D 0651', 'D')
      on conflict do nothing;
    ${membro(GESTOR, ORG_A, "manager", "gerente")}
    ${membro(APOIO, ORG_A, "agent", "apoio")}
    ${membro(VEND_1, ORG_A, "agent", "vendedor")}
    ${membro(VEND_2, ORG_A, "agent", "vendedor")}
    ${membro(SDR, ORG_A, "agent", "sdr")}
    ${membro(REVOGADO, ORG_A, "agent", "vendedor", true)}
    ${membro(ANALISTA, ORG_A, "agent", "analista_ficha")}
    ${membro(DE_B, ORG_B, "agent", "vendedor")}
    ${membro(GESTOR_B, ORG_B, "manager", "gerente")}
    ${membro(ENVIA_C, ORG_C, "manager", "gerente")}
    ${membro(RECEBE_C, ORG_C, "agent", "vendedor")}
    ${membro(OUTRO_C, ORG_C, "agent", "vendedor")}
    ${membro(ENVIA_D, ORG_D, "manager", "gerente")}
    ${membro(RECEBE_D, ORG_D, "agent", "vendedor")}
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
      values ('${PLATAFORMA}', '${PLATAFORMA}', 'full', false, 'Fixture 0651') on conflict do nothing;
  `);
  PARA_VENDEDOR = enviar({
    org: ORG_A,
    alvo: "funcao",
    funcao: "vendedor",
    titulo: "Para vendedores",
  });
  PARA_SDR = enviar({ org: ORG_A, alvo: "funcao", funcao: "sdr", titulo: "Para SDR" });
  PARA_GERENTE = enviar({ org: ORG_A, alvo: "funcao", funcao: "gerente", titulo: "Para gerentes" });
});

function destinatarios(comunicado: string): string[] {
  return sql(
    `select user_id from public.iavek_comunicados_destinatarios where comunicado_id = '${comunicado}' order by user_id;`,
  )
    .split("\n")
    .filter(Boolean);
}

describe("0651: quem recebe", () => {
  it("por função: só os membros ATIVOS daquela função; nunca o revogado nem quem enviou", () => {
    expect(destinatarios(PARA_VENDEDOR)).toEqual([VEND_1, VEND_2].sort());
    expect(destinatarios(PARA_SDR)).toEqual([SDR]);
  });

  it("'gerente' alcança o gerente de apoio (a régua da 0598), e quem enviou não entra", () => {
    expect(destinatarios(PARA_GERENTE)).toEqual([APOIO]);
  });

  it("o sino: 1 aviso por destinatário, do tipo novo, com o id e o título e sem o texto", () => {
    const linhas =
      sql(`select user_id || '|' || tipo || '|' || (dados->>'titulo') || '|' || (dados ? 'texto')::text
        from public.notificacoes where dados->>'comunicado_id' = '${PARA_VENDEDOR}' order by user_id;`).split(
        "\n",
      );
    expect(linhas).toEqual(
      [VEND_1, VEND_2].sort().map((id) => `${id}|orientacao_da_loja|Para vendedores|false`),
    );
  });

  it("(H) para uma pessoa de OUTRA org, revogada ou analista de ficha: recusado", () => {
    for (const pessoa of [DE_B, REVOGADO, ANALISTA]) {
      expect(
        falha(
          `set role service_role; select * from public.fn_iavek_enviar_comunicado('${ORG_A}', 'orientacao', 't', 'x', 'pessoa', null, '${pessoa}', true, '${GESTOR}', null, null);`,
        ),
      ).toMatch(/membro ativo/);
    }
  });

  it("(H) quem envia tem de ser membro ativo da mesma org; a orientação sem quem enviou é recusada", () => {
    expect(
      falha(
        `set role service_role; select * from public.fn_iavek_enviar_comunicado('${ORG_A}', 'orientacao', 't', 'x', 'funcao', 'vendedor', null, true, '${DE_B}', null, null);`,
      ),
    ).toMatch(/Quem envia/);
    expect(
      falha(
        `set role service_role; select * from public.fn_iavek_enviar_comunicado('${ORG_A}', 'orientacao', 't', 'x', 'funcao', 'vendedor', null, true, null, null, null);`,
      ),
    ).toMatch(/precisa de quem a enviou/);
  });

  it("corrigir uma de OUTRA org é recusado", () => {
    const deB = enviar({ org: ORG_B, alvo: "funcao", funcao: "vendedor", por: GESTOR_B });
    expect(
      falha(
        `set role service_role; select * from public.fn_iavek_enviar_comunicado('${ORG_A}', 'orientacao', 't', 'x', 'funcao', 'vendedor', null, true, '${GESTOR}', '${deB}', null);`,
      ),
    ).toMatch(/não é desta organização/);
  });

  it("ninguém recebe: recusado, e NENHUMA linha fica (é uma transação só)", () => {
    const antes = numero(
      `select count(*) from public.iavek_comunicados where organization_id = '${ORG_A}';`,
    );
    expect(
      falha(
        `set role service_role; select * from public.fn_iavek_enviar_comunicado('${ORG_A}', 'orientacao', 't', 'x', 'funcao', 'sdr_followup', null, true, '${GESTOR}', null, null);`,
      ),
    ).toMatch(/Ninguém recebe/);
    expect(
      numero(`select count(*) from public.iavek_comunicados where organization_id = '${ORG_A}';`),
    ).toBe(antes);
  });

  it("a função de envio é só do service_role: o gestor logado não a chama", () => {
    expect(
      falha(
        como(
          GESTOR,
          `select * from public.fn_iavek_enviar_comunicado('${ORG_A}', 'orientacao', 't', 'x', 'funcao', 'vendedor', null, true, '${GESTOR}', null, null);`,
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("0651: quem vê (RLS)", () => {
  it("o vendedor vê o dele e não o da SDR, nem o retrato e as leituras dos outros", () => {
    expect(
      countAs(
        VEND_1,
        `select count(*) from public.iavek_comunicados where id = '${PARA_VENDEDOR}'`,
      ),
    ).toBe(1);
    expect(
      countAs(VEND_1, `select count(*) from public.iavek_comunicados where id = '${PARA_SDR}'`),
    ).toBe(0);
    expect(
      countAs(
        VEND_1,
        `select count(*) from public.iavek_comunicados_destinatarios where user_id <> '${VEND_1}'`,
      ),
    ).toBe(0);
  });

  it("o gestor e o admin da plataforma veem tudo da org", () => {
    const total = numero(
      `select count(*) from public.iavek_comunicados where organization_id = '${ORG_A}';`,
    );
    expect(total).toBeGreaterThanOrEqual(3);
    expect(
      countAs(
        GESTOR,
        `select count(*) from public.iavek_comunicados where organization_id = '${ORG_A}'`,
      ),
    ).toBe(total);
    expect(
      countAs(
        PLATAFORMA,
        `select count(*) from public.iavek_comunicados where organization_id = '${ORG_A}'`,
      ),
    ).toBe(total);
    expect(
      countAs(
        GESTOR,
        `select count(*) from public.iavek_comunicados_destinatarios where organization_id = '${ORG_A}'`,
      ),
    ).toBeGreaterThanOrEqual(4);
  });

  it("a outra org não vê nada, nem o gestor dela (cross-tenant)", () => {
    for (const quem of [DE_B, GESTOR_B]) {
      expect(
        countAs(
          quem,
          `select count(*) from public.iavek_comunicados where organization_id = '${ORG_A}'`,
        ),
      ).toBe(0);
      expect(
        countAs(
          quem,
          `select count(*) from public.iavek_comunicados_destinatarios where organization_id = '${ORG_A}'`,
        ),
      ).toBe(0);
      expect(
        countAs(
          quem,
          `select count(*) from public.iavek_comunicados_lidos where organization_id = '${ORG_A}'`,
        ),
      ).toBe(0);
    }
  });

  it("o authenticated não grava comunicado nem retrato direto", () => {
    expect(
      falha(
        como(
          GESTOR,
          `insert into public.iavek_comunicados (organization_id, tipo, titulo, texto, alvo, para_funcao, enviado_por) values ('${ORG_A}', 'orientacao', 't', 'x', 'funcao', 'vendedor', '${GESTOR}');`,
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      falha(
        como(
          GESTOR,
          `insert into public.iavek_comunicados_destinatarios (comunicado_id, user_id, organization_id) values ('${PARA_SDR}', '${VEND_1}', '${ORG_A}');`,
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("0651: o 'li e entendi'", () => {
  it("grava o da pessoa, apaga a bolinha do sino dela e é idempotente", () => {
    sql(como(VEND_1, `select public.fn_iavek_li_e_entendi('${PARA_VENDEDOR}');`));
    sql(como(VEND_1, `select public.fn_iavek_li_e_entendi('${PARA_VENDEDOR}');`));
    expect(
      numero(
        `select count(*) from public.iavek_comunicados_lidos where comunicado_id = '${PARA_VENDEDOR}' and user_id = '${VEND_1}';`,
      ),
    ).toBe(1);
    expect(
      numero(
        `select count(*) from public.notificacoes where user_id = '${VEND_1}' and dados->>'comunicado_id' = '${PARA_VENDEDOR}' and lida_em is null;`,
      ),
    ).toBe(0);
    // controle: o do VEND_2 segue sem ler.
    expect(
      numero(
        `select count(*) from public.notificacoes where user_id = '${VEND_2}' and dados->>'comunicado_id' = '${PARA_VENDEDOR}' and lida_em is null;`,
      ),
    ).toBe(1);
  });

  it("quem não é destinatário não lê: nem pela função, nem por INSERT direto, nem pela linha de outro", () => {
    expect(falha(como(SDR, `select public.fn_iavek_li_e_entendi('${PARA_VENDEDOR}');`))).toMatch(
      /não é para você/,
    );
    expect(
      falha(
        como(
          SDR,
          `insert into public.iavek_comunicados_lidos (comunicado_id, user_id, organization_id) values ('${PARA_VENDEDOR}', '${SDR}', '${ORG_A}');`,
        ),
      ),
    ).toMatch(/row-level security|violates foreign key/); // a policy (Lupa 121236) barra antes da FK
    expect(
      falha(
        como(
          SDR,
          `insert into public.iavek_comunicados_lidos (comunicado_id, user_id, organization_id) values ('${PARA_VENDEDOR}', '${VEND_2}', '${ORG_A}');`,
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe("0651: não se edita, não se apaga (até para o service_role)", () => {
  const MUDANCAS = [
    "titulo = 'outro'",
    "texto = 'outro'",
    `substitui_id = '${"00000000-0000-4000-8000-000000000000"}'`,
    "pede_leitura = false",
    `organization_id = '${ORG_B}'`,
    "alvo = 'pessoa', para_funcao = null",
    "versao = '9.9'",
    "tipo = 'novidade', versao = '9.9'",
    "enviado_em = now() - interval '1 day'",
    "para_funcao = 'sdr'",
  ];

  it("cada coluna é recusada pela lista branca", () => {
    for (const m of MUDANCAS) {
      expect(
        falha(
          `set role service_role; update public.iavek_comunicados set ${m} where id = '${PARA_VENDEDOR}';`,
        ),
        m,
      ).toMatch(/não se edita/);
    }
  });

  it("o enviado_por só pode ir a NULO, nunca a outra pessoa", () => {
    expect(
      falha(
        `set role service_role; update public.iavek_comunicados set enviado_por = '${VEND_1}' where id = '${PARA_VENDEDOR}';`,
      ),
    ).toMatch(/não se edita/);
  });

  it("o retrato e as leituras não se editam", () => {
    sql(como(VEND_1, `select public.fn_iavek_li_e_entendi('${PARA_VENDEDOR}');`)); // garante a linha (idempotente)
    expect(
      falha(
        `set role service_role; update public.iavek_comunicados_destinatarios set funcao_no_envio = 'x' where comunicado_id = '${PARA_VENDEDOR}';`,
      ),
    ).toMatch(/não se edita/);
    expect(
      falha(
        `set role service_role; update public.iavek_comunicados_lidos set lida_em = now() where comunicado_id = '${PARA_VENDEDOR}';`,
      ),
    ).toMatch(/não se edita/);
    expect(
      falha(
        como(
          VEND_1,
          `update public.iavek_comunicados_lidos set lida_em = now() where comunicado_id = '${PARA_VENDEDOR}';`,
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("nenhum DELETE direto passa nas 3 tabelas", () => {
    sql(como(VEND_1, `select public.fn_iavek_li_e_entendi('${PARA_VENDEDOR}');`)); // garante a linha (idempotente)
    expect(
      falha(
        `set role service_role; delete from public.iavek_comunicados_lidos where comunicado_id = '${PARA_VENDEDOR}';`,
      ),
    ).toMatch(/não se apaga/);
    expect(
      falha(
        `set role service_role; delete from public.iavek_comunicados_destinatarios where comunicado_id = '${PARA_VENDEDOR}';`,
      ),
    ).toMatch(/não se apaga/);
    expect(
      falha(
        `set role service_role; delete from public.iavek_comunicados where id = '${PARA_VENDEDOR}';`,
      ),
    ).toMatch(/não se apaga/);
    expect(
      numero(`select count(*) from public.iavek_comunicados where id = '${PARA_VENDEDOR}';`),
    ).toBe(1);
  });
});

describe("0651: apagar a PESSOA funciona (Lupa A)", () => {
  it("quem ENVIOU, RECEBEU (por função e por pessoa) e LEU é apagado; o comunicado continua", () => {
    const porFuncao = enviar({ org: ORG_C, alvo: "funcao", funcao: "vendedor", por: ENVIA_C });
    const porPessoa = enviar({ org: ORG_C, alvo: "pessoa", pessoa: RECEBE_C, por: ENVIA_C });
    sql(
      como(
        RECEBE_C,
        `select public.fn_iavek_li_e_entendi('${porFuncao}'); select public.fn_iavek_li_e_entendi('${porPessoa}');`,
      ),
    );
    expect(
      numero(`select count(*) from public.iavek_comunicados_lidos where user_id = '${RECEBE_C}';`),
    ).toBe(2);

    sql(`delete from auth.users where id in ('${ENVIA_C}', '${RECEBE_C}');`);

    expect(
      numero(`select count(*) from public.iavek_comunicados where organization_id = '${ORG_C}';`),
    ).toBe(2);
    expect(
      numero(
        `select count(*) from public.iavek_comunicados where organization_id = '${ORG_C}' and enviado_por is null;`,
      ),
    ).toBe(2);
    expect(
      numero(
        `select count(*) from public.iavek_comunicados where id = '${porPessoa}' and para_usuario is null;`,
      ),
    ).toBe(1);
    expect(
      numero(
        `select count(*) from public.iavek_comunicados_destinatarios where user_id = '${RECEBE_C}';`,
      ),
    ).toBe(0);
    expect(
      numero(`select count(*) from public.iavek_comunicados_lidos where user_id = '${RECEBE_C}';`),
    ).toBe(0);
    // controle: o outro vendedor segue no retrato.
    expect(destinatarios(porFuncao)).toEqual([OUTRO_C]);
  });
});

describe("0651: apagar a ORG leva a cadeia inteira (Lupa F e I)", () => {
  it("org → comunicados (com correções A ← B ← C) → retrato → leituras, sem sobrar linha", () => {
    const a = enviar({ org: ORG_D, alvo: "funcao", funcao: "vendedor", por: ENVIA_D, titulo: "A" });
    const b = enviar({
      org: ORG_D,
      alvo: "funcao",
      funcao: "vendedor",
      por: ENVIA_D,
      titulo: "B",
      substitui: a,
    });
    const c = enviar({
      org: ORG_D,
      alvo: "funcao",
      funcao: "vendedor",
      por: ENVIA_D,
      titulo: "C",
      substitui: b,
    });
    sql(
      como(
        RECEBE_D,
        `select public.fn_iavek_li_e_entendi('${a}'); select public.fn_iavek_li_e_entendi('${b}'); select public.fn_iavek_li_e_entendi('${c}');`,
      ),
    );
    expect(
      numero(
        `select count(*) from public.iavek_comunicados_lidos where organization_id = '${ORG_D}';`,
      ),
    ).toBe(3);

    sql(`delete from public.organizations where id = '${ORG_D}';`);

    for (const t of [
      "iavek_comunicados",
      "iavek_comunicados_destinatarios",
      "iavek_comunicados_lidos",
    ]) {
      expect(
        numero(`select count(*) from public.${t} where organization_id = '${ORG_D}';`),
        t,
      ).toBe(0);
    }
  });
});

describe("0651: o check do sino", () => {
  it("mantém os tipos de antes e aceita os 2 novos", () => {
    const def = sql(
      `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notificacoes_tipo_check';`,
    );
    for (const tipo of [
      "lead_passado",
      "aviso_da_loja",
      "ia_travou",
      "agendamento_no_seu_lead",
      "orientacao_da_loja",
      "novidade_da_versao",
    ]) {
      expect(def, tipo).toContain(`'${tipo}'`);
    }
  });
});
