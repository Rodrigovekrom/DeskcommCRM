import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_CONTACT_2, GOV_ORG, GOV_PIPELINE, GOV_STAGE, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * ia.vek v1.8.3 (migration 0591) — guardião na chegada.
 * Todo lead vai primeiro a um SDR: quando o lead GANHA dono com função SDR (rodízio,
 * atribuição à mão ou criado já com dono), esse SDR vira o guardião. Passar ao
 * vendedor não apaga o guardião. A trava aceita o dono SDR como guardião.
 * A=SDR, B=vendedor.
 */
const L = (n: number) => `ab1e0000-7777-4000-8000-00000000000${n}`;
const guardiao = (id: string) => lastLine(sql(`select coalesce(sdr_user_id::text, '-') from public.crm_leads where id = '${id}';`));
const funcao = (user: string, f: string | null) =>
  sql(`update public.user_organizations set interface_settings =
         ${f ? `coalesce(interface_settings,'{}'::jsonb) || '{"funcao":"${f}"}'::jsonb` : `coalesce(interface_settings,'{}'::jsonb) - 'funcao'`}
       where organization_id = '${GOV_ORG}' and user_id = '${user}';`);
const novo = (id: string, dono: string | null, sdr: string | null = null) =>
  sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, contact_id, owner_user_id, owner_kind, sdr_user_id)
         values ('${id}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Guardião', '${GOV_CONTACT_2}',
                 ${dono ? `'${dono}'` : "null"}, ${dono ? "'user'" : "null"}, ${sdr ? `'${sdr}'` : "null"});`);

beforeAll(() => {
  seedGov();
  sql(`delete from public.crm_leads where id::text like 'ab1e0000-7777-%';`);
  funcao(GOV_AGENT_A, "sdr");
  funcao(GOV_AGENT_B, "vendedor");
});

afterAll(() => {
  sql(`delete from public.crm_leads where id::text like 'ab1e0000-7777-%';`);
  funcao(GOV_AGENT_A, null);
  funcao(GOV_AGENT_B, null);
});

describe("guardião na chegada", () => {
  it("lead criado já com dono SDR nasce com ele de guardião", () => {
    novo(L(1), GOV_AGENT_A);
    expect(guardiao(L(1))).toBe(GOV_AGENT_A);
  });

  it("lead criado com dono vendedor não ganha guardião", () => {
    novo(L(2), GOV_AGENT_B);
    expect(guardiao(L(2))).toBe("-");
  });

  it("lead sem dono que o rodízio entrega a um SDR ganha o guardião (UPDATE do dono)", () => {
    novo(L(3), null);
    sql(`update public.crm_leads set owner_user_id = '${GOV_AGENT_A}', owner_kind = 'user' where id = '${L(3)}';`);
    expect(guardiao(L(3))).toBe(GOV_AGENT_A);
  });

  it("passar do SDR ao vendedor mantém o guardião", () => {
    sql(`update public.crm_leads set owner_user_id = '${GOV_AGENT_B}' where id = '${L(3)}';`);
    expect(guardiao(L(3))).toBe(GOV_AGENT_A);
  });

  it("guardião informado na criação nunca é trocado", () => {
    novo(L(4), GOV_AGENT_A, GOV_AGENT_B);
    expect(guardiao(L(4))).toBe(GOV_AGENT_B);
  });

  it("v1.9.4b (0597): o guardião saiu da lista da trava — nem o lead do SDR nem o do vendedor o pedem", () => {
    sql(`update public.crm_leads set sdr_user_id = null where id = '${L(1)}';`);
    for (const lead of [L(1), L(2)]) {
      const faltam = lastLine(sql(`select array_to_string(faltam, '|') from public.fn_iavek_campos_que_faltam(array['${lead}'::uuid]);`));
      expect(faltam).not.toContain("Guardião responsável");
    }
  });
});
