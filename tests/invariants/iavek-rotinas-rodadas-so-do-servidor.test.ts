/**
 * ia.vek v1.9.60 (0643, CRM-490): `iavek_rotinas_rodadas` (a última rodada das rotinas automáticas) é EXCLUSIVA do
 * servidor: RLS ligada, zero policies, grants revogados de anon/authenticated. Prova comportamental: o admin de uma
 * organização não lê, não grava e não apaga; o anon também não; o service_role (controle positivo) grava e lê.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

function como(papel: "authenticated" | "anon" | "service_role", userId: string | null, comando: string): string {
  return sql(`set role ${papel};
    ${userId ? `select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);` : ""}
    ${comando};`);
}

function recusado(userId: string | null, comando: string, papel: "authenticated" | "anon" = "authenticated"): string {
  try {
    como(papel, userId, comando);
  } catch (err) {
    return motivoDoErro(err);
  }
  return "PASSOU";
}

beforeAll(() => {
  seedGov();
  sql(`insert into public.iavek_rotinas_rodadas (rotina, ultimo_resultado) values ('inv-0643', '{"jobs_apagados": 0}')
       on conflict (rotina) do nothing;`);
});

describe("0643: iavek_rotinas_rodadas só do servidor", () => {
  it("o admin da organização não lê, não grava, não muda e não apaga", () => {
    expect(recusado(GOV_ADMIN, `select count(*) from public.iavek_rotinas_rodadas`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `insert into public.iavek_rotinas_rodadas (rotina) values ('inv-0643-x')`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `update public.iavek_rotinas_rodadas set ultimo_resultado = '{}' where rotina = 'inv-0643'`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `delete from public.iavek_rotinas_rodadas where rotina = 'inv-0643'`)).toMatch(/permission denied/);
  });

  it("o anon também não", () => {
    expect(recusado(null, `select count(*) from public.iavek_rotinas_rodadas`, "anon")).toMatch(/permission denied/);
  });

  it("controle positivo: o service_role grava e lê", () => {
    const out = como("service_role", null, `insert into public.iavek_rotinas_rodadas (rotina, ultimo_resultado) values ('inv-0643', '{"tandas": 1}')
      on conflict (rotina) do update set ultimo_resultado = excluded.ultimo_resultado, ultima_em = now();
      select ultimo_resultado->>'tandas' from public.iavek_rotinas_rodadas where rotina = 'inv-0643'`);
    expect(out).toContain("1");
  });
});
