/**
 * ia.vek v1.9.60 (0646, CRM-491): `iavek_turnos_da_ia` (um registro por turno respondido pela IA) é EXCLUSIVA do
 * servidor: RLS ligada, zero policies, grants revogados de anon/authenticated. Prova comportamental: o admin de uma
 * organização não lê, não grava e não apaga; o anon também não; o service_role (controle positivo) grava e lê.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ADMIN, GOV_ORG, seedGov, sql } from "./gov-helpers";
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
  sql(`insert into public.iavek_turnos_da_ia (id, organization_id, kind, modelo) values ('e1fe0646-0000-4000-8000-000000000001', '${GOV_ORG}', 'inbound_turn', 'modelo-inv')
       on conflict (id) do nothing;`);
});

describe("0646: iavek_turnos_da_ia só do servidor", () => {
  it("o admin da organização não lê, não grava, não muda e não apaga", () => {
    expect(recusado(GOV_ADMIN, `select count(*) from public.iavek_turnos_da_ia`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `insert into public.iavek_turnos_da_ia (organization_id) values ('${GOV_ORG}')`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `update public.iavek_turnos_da_ia set modelo = 'x' where id = 'e1fe0646-0000-4000-8000-000000000001'`)).toMatch(/permission denied/);
    expect(recusado(GOV_ADMIN, `delete from public.iavek_turnos_da_ia where id = 'e1fe0646-0000-4000-8000-000000000001'`)).toMatch(/permission denied/);
  });

  it("o anon também não", () => {
    expect(recusado(null, `select count(*) from public.iavek_turnos_da_ia`, "anon")).toMatch(/permission denied/);
  });

  it("controle positivo: o service_role grava e lê", () => {
    const out = como("service_role", null, `insert into public.iavek_turnos_da_ia (organization_id, kind, modelo) values ('${GOV_ORG}', 'inbound_turn', 'modelo-sr');
      select count(*) from public.iavek_turnos_da_ia where modelo = 'modelo-sr'`);
    expect(out).toContain("1");
  });
});
