/**
 * ia.vek CRM-434 (0652): a VOLTA deixa o banco como na 0651. A cópia `tests/invariants/fixtures/voltar-0652.sql` tem o
 * MESMO md5 do voltar-0652.sql de operação. Banco só deste arquivo: com a 0652 aplicada (o baseline), confere que a
 * função e o gatilho existem e o check tem 24 tipos; roda a volta; confere que somem, que o check volta às 23 (sem
 * 'resposta_de_outro') e que um aviso já gravado do tipo sai.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

function tipos(): string[] {
  const def = sql(
    `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notificacoes_tipo_check';`,
  );
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
}
function numero(script: string): number {
  return Number(sql(script).split("\n").pop());
}
const OBJETOS = `select
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'fn_iavek_avisa_resposta_de_outro')
  + (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname = 'trg_iavek_avisa_resposta_de_outro');`;

describe("0652: a volta", () => {
  it("controle: antes, a função e o gatilho existem e o check tem 24 tipos", () => {
    expect(numero(OBJETOS)).toBe(2);
    expect(tipos()).toHaveLength(24);
    expect(tipos()).toContain("resposta_de_outro");
  });

  it("depois: nada da 0652 sobra, o check volta às 23 e o aviso gravado sai", () => {
    const ORG = "a5340652-0000-4000-8000-0000000000f0";
    const U = "a5340652-0001-4000-8000-0000000000f1";
    sql(`insert into auth.users (id, email) values ('${U}', 'c434v@invariant.test') on conflict do nothing;
      insert into public.organizations (id, slug, legal_name, display_name) values ('${ORG}', 'c434-volta', 'Org volta 0652', 'V')
        on conflict do nothing;
      insert into public.notificacoes (organization_id, user_id, tipo, dados) values ('${ORG}', '${U}', 'resposta_de_outro', '{}');`);
    sql(readFileSync(join(__dirname, "fixtures", "voltar-0652.sql"), "utf8"));
    expect(numero(OBJETOS)).toBe(0);
    expect(tipos()).toHaveLength(23);
    expect(tipos()).not.toContain("resposta_de_outro");
    expect(tipos()).toContain("orientacao_da_loja");
    expect(
      numero(`select count(*) from public.notificacoes where tipo = 'resposta_de_outro';`),
    ).toBe(0);
  });
});
