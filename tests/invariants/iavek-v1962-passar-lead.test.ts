/**
 * ia.vek v1.9.62 (0650, CRM-497 D4; Lupa 1718): fn_iavek_passar_lead, a passagem por pessoa numa transação só.
 * Só do servidor; recusa com tarefa de pessoa aberta (e NADA muda), com o dono diferente do conferido, com o lead fechado;
 * passa trocando dono e guardião e fechando as automáticas com 'passou_o_lead'.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_MANAGER, GOV_ORG, GOV_PIPELINE, GOV_STAGE, lastLine, seedGov, sql } from "./gov-helpers";
import { motivoDoErro } from "./psql-transporte";

const N = "eeeeeeee-0650-4000-8000-000000000";
const LEAD = `${N}001`;
const LEAD_FECHADO = `${N}002`;
const T_PESSOA = `${N}011`;
const T_AUTO = `${N}012`;

const valor = (q: string) => lastLine(sql(q));
const passar = (lead: string, anterior: string | null, dono: string, guardiao: string | null) =>
  JSON.parse(
    valor(`set role service_role; select public.fn_iavek_passar_lead('${GOV_ORG}', '${lead}', ${anterior ? `'${anterior}'` : "null"}, '${dono}', ${guardiao ? `'${guardiao}'` : "null"})::text;`),
  ) as { ok: boolean; motivo?: string; tarefas?: Array<{ id: string }>; automaticas?: number };

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id, owner_kind) values
      ('${LEAD}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Passar 0650', '${GOV_AGENT_B}', 'user'),
      ('${LEAD_FECHADO}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', 'Fechado 0650', '${GOV_AGENT_B}', 'user')
      on conflict (id) do nothing;
    update public.crm_leads set status='won', closed_at=now() where id='${LEAD_FECHADO}';
    insert into public.crm_tasks (id, organization_id, title, lead_id, assigned_to, due_date, status, source_kind) values
      ('${T_PESSOA}', '${GOV_ORG}', 'De pessoa', '${LEAD}', '${GOV_AGENT_B}', now() + interval '1 day', 'pending', null),
      ('${T_AUTO}', '${GOV_ORG}', 'L2', '${LEAD}', '${GOV_AGENT_B}', now() + interval '1 day', 'pending', 'ligacao:L2')
      on conflict (id) do nothing;
  `);
});

describe("0650: fn_iavek_passar_lead", () => {
  it("é só do servidor: o authenticated não executa", () => {
    let erro = "";
    try {
      sql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${GOV_MANAGER}"}', false);
           select public.fn_iavek_passar_lead('${GOV_ORG}', '${LEAD}', '${GOV_AGENT_B}', '${GOV_AGENT_A}', null);`);
    } catch (e) {
      erro = motivoDoErro(e);
    }
    expect(erro).toMatch(/permission denied/);
  });

  it("com tarefa de PESSOA aberta: recusa com a lista, e NADA muda (nem o dono, nem a automática)", () => {
    const r = passar(LEAD, GOV_AGENT_B, GOV_AGENT_A, GOV_AGENT_B);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("tarefas_abertas");
    expect(r.tarefas?.map((t) => t.id)).toEqual([T_PESSOA]);
    expect(valor(`select owner_user_id from public.crm_leads where id='${LEAD}';`)).toBe(GOV_AGENT_B);
    expect(valor(`select status from public.crm_tasks where id='${T_AUTO}';`)).toBe("pending");
  });

  it("o dono não é o que a rota conferiu: 'dono_mudou', nada muda", () => {
    sql(`update public.crm_tasks set status='done' where id='${T_PESSOA}';`);
    const r = passar(LEAD, GOV_MANAGER, GOV_AGENT_A, null);
    expect(r).toEqual({ ok: false, motivo: "dono_mudou" });
    expect(valor(`select owner_user_id from public.crm_leads where id='${LEAD}';`)).toBe(GOV_AGENT_B);
  });

  it("lead fechado: 'lead_fechado'", () => {
    expect(passar(LEAD_FECHADO, GOV_AGENT_B, GOV_AGENT_A, null)).toEqual({ ok: false, motivo: "lead_fechado" });
  });

  it("sem tarefa de pessoa aberta: troca dono e guardião e fecha a automática com 'passou_o_lead'", () => {
    const r = passar(LEAD, GOV_AGENT_B, GOV_AGENT_A, GOV_AGENT_B);
    expect(r).toEqual({ ok: true, automaticas: 1 });
    expect(valor(`select owner_user_id || '/' || sdr_user_id from public.crm_leads where id='${LEAD}';`)).toBe(`${GOV_AGENT_A}/${GOV_AGENT_B}`);
    expect(valor(`select status || '/' || cancelada_motivo from public.crm_tasks where id='${T_AUTO}';`)).toBe("cancelled/passou_o_lead");
    expect(valor(`select status from public.crm_tasks where id='${T_PESSOA}';`)).toBe("done");
  });
});
