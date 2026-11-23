/**
 * ia.vek CRM-439 (0651): a VOLTA deixa o banco como antes (Lupa 121236, C2).
 *
 * A volta que roda no servidor é o `voltar-0651.sql` do repo de operação; a cópia aqui
 * (`tests/invariants/fixtures/voltar-0651.sql`) tem o MESMO md5, conferido antes de usar a de lá.
 * Num banco só deste arquivo: com a 0651 aplicada (o baseline), grava um comunicado de verdade (com o aviso no sino),
 * roda a volta e confere que as 3 tabelas e as 5 funções somem, que os avisos dos 2 tipos saem e que o check do sino
 * volta à lista da 0629 — nem um tipo a mais, nem um a menos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

const ORG = "a5390651-0000-4000-8000-0000000000f0";
const GESTOR = "a5390651-2222-4000-8000-000000000001";
const VEND = "a5390651-2222-4000-8000-000000000002";

/** A lista da 0629 (supabase/migrations/20261112041000_0629_iavek_aviso_agendamento_no_seu_lead.sql). */
const TIPOS_DA_0629 = [
  "lead_passado",
  "guardiao_etapa",
  "guardiao_ganho",
  "guardiao_perda",
  "guardiao_tarefa_vencida",
  "tarefa_vencida",
  "proposta_aguardando_aprovacao",
  "proposta_aprovada",
  "proposta_devolvida",
  "pedido_de_agendamento",
  "pedido_de_agendamento_confirmado",
  "pedido_de_agendamento_recusado",
  "ficha_enviada",
  "ficha_decidida",
  "agendamento_para_voce",
  "lead_devolvido",
  "lead_retirado",
  "lead_reativado",
  "aviso_da_loja",
  "ia_travou",
  "agendamento_no_seu_lead",
].sort();

function tiposDoCheck(): string[] {
  const def = sql(
    `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notificacoes_tipo_check';`,
  );
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!).sort();
}

function numero(script: string): number {
  return Number(sql(script).split("\n").pop());
}

const OBJETOS = `select
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('iavek_comunicados', 'iavek_comunicados_destinatarios', 'iavek_comunicados_lidos'))
  + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('fn_iavek_enviar_comunicado', 'fn_iavek_li_e_entendi',
        'fn_iavek_comunicado_nao_edita', 'fn_iavek_comunicado_nao_apaga', 'fn_iavek_comunicado_registro_fixo'));`;

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${GESTOR}', 'c439v-1@invariant.test'), ('${VEND}', 'c439v-2@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}', 'c439-volta', 'Org volta 0651', 'V')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at, interface_settings) values
      ('${GESTOR}', '${ORG}', 'manager', now(), '{"preset":"completa","funcao":"gerente"}'::jsonb),
      ('${VEND}', '${ORG}', 'agent', now(), '{"preset":"completa","funcao":"vendedor"}'::jsonb)
      on conflict do nothing;
    set role service_role;
    select * from public.fn_iavek_enviar_comunicado('${ORG}', 'orientacao', 'Antes da volta', 'x', 'funcao', 'vendedor',
      null, true, '${GESTOR}', null, null);
  `);
});

describe("0651: a volta", () => {
  it("controle: antes da volta, as 3 tabelas e as 5 funções existem, e o check tem as 21 da 0629 mais as 2 novas", () => {
    expect(numero(OBJETOS)).toBe(8);
    expect(tiposDoCheck()).toEqual(
      [...TIPOS_DA_0629, "novidade_da_versao", "orientacao_da_loja"].sort(),
    );
    expect(
      numero(`select count(*) from public.notificacoes where tipo = 'orientacao_da_loja';`),
    ).toBe(1);
  });

  it("depois da volta: nada da 0651 sobra e o check é o da 0629", () => {
    sql(readFileSync(join(__dirname, "fixtures", "voltar-0651.sql"), "utf8"));
    expect(numero(OBJETOS)).toBe(0);
    expect(
      numero(
        `select count(*) from public.notificacoes where tipo in ('orientacao_da_loja', 'novidade_da_versao');`,
      ),
    ).toBe(0);
    expect(tiposDoCheck()).toEqual(TIPOS_DA_0629);
  });
});
