/**
 * ia.vek v1.9.62 (0648, CRM-535): o lead que vira de um VENDEDOR vai para a coluna de entrada dele, por gatilho, em
 * todo caminho, SÓ onde o funil tem settings.etapa_de_entrada_do_vendedor. Prova comportamental:
 *  - troca de dono para vendedor, etapa antes da coluna: vai para a coluna, com 1 linha stage_changed (rule) e 1
 *    lead.stage_changed; o stage_changed_at é carimbado;
 *  - para dono que não é vendedor, etapa já depois da coluna, a mesma escrita escolhendo a etapa, o sinal
 *    administrativo, o lead fechado, o funil sem a config: NÃO move;
 *  - o lead que NASCE com um vendedor de dono também vai.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

const N = "eeeeeeee-0648-4000-8000-000000000";
const FUNIL = `${N}001`;
const FUNIL_SEM = `${N}002`;
const IA = `${N}011`; // posição 1000
const PARA_ATENDER = `${N}012`; // 2500
const EM_ATENDIMENTO = `${N}013`; // 3000
const SEM_IA = `${N}021`;
const L = (n: string) => `${N}1${n}`;

const valor = (q: string) => lastLine(sql(q));
const etapa = (id: string) => valor(`select stage_id from public.crm_leads where id='${id}';`);
const linhas = (id: string) =>
  valor(`select count(*) from public.crm_lead_activities where lead_id='${id}' and type='stage_changed' and metadata->>'origem'='gatilho_0648';`);
const eventos = (id: string) =>
  valor(`select count(*) from public.event_log where event_type='lead.stage_changed' and entity_id='${id}' and metadata->>'origem'='gatilho_0648';`);
const funcao = (u: string, f: string) =>
  sql(`update public.user_organizations set interface_settings=coalesce(interface_settings,'{}'::jsonb)||'{"funcao":"${f}"}'::jsonb where organization_id='${GOV_ORG}' and user_id='${u}';`);
const lead = (id: string, funil: string, et: string, extra = "") =>
  sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title${extra ? ", " + extra.split("=")[0] : ""})
       values ('${id}', '${GOV_ORG}', '${funil}', '${et}', 'Lead 0648'${extra ? ", " + extra.split("=")[1] : ""}) on conflict (id) do nothing;`);

beforeAll(() => {
  seedGov();
  funcao(GOV_AGENT_A, "vendedor");
  funcao(GOV_AGENT_B, "sdr");
  sql(`
    insert into public.crm_pipelines (id, organization_id, name, slug, settings) values
      ('${FUNIL}', '${GOV_ORG}', 'Entrada 0648', 'entrada-0648', '{"etapa_de_entrada_do_vendedor":"para-atender-0648"}'::jsonb),
      ('${FUNIL_SEM}', '${GOV_ORG}', 'Sem config 0648', 'sem-0648', '{}'::jsonb)
      on conflict (id) do nothing;
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
      ('${IA}', '${GOV_ORG}', '${FUNIL}', 'IA Atendendo 0648', 'ia-0648', 1000),
      ('${PARA_ATENDER}', '${GOV_ORG}', '${FUNIL}', 'Para atender', 'para-atender-0648', 2500),
      ('${EM_ATENDIMENTO}', '${GOV_ORG}', '${FUNIL}', 'Em atendimento 0648', 'em-atendimento-0648', 3000),
      ('${SEM_IA}', '${GOV_ORG}', '${FUNIL_SEM}', 'IA 0648 sem', 'ia-sem-0648', 1000)
      on conflict (id) do nothing;
  `);
  lead(L("01"), FUNIL, IA);
  lead(L("02"), FUNIL, IA);
  lead(L("03"), FUNIL, EM_ATENDIMENTO);
  lead(L("04"), FUNIL, IA);
  lead(L("05"), FUNIL, IA);
  lead(L("06"), FUNIL_SEM, SEM_IA);
  lead(L("07"), FUNIL, IA);
});

describe("0648: o lead do vendedor vai para a coluna de entrada dele", () => {
  it("troca de dono para um VENDEDOR, a etapa antes da coluna: vai, com a linha do tempo, o evento e a hora da etapa", () => {
    sql(`update public.crm_leads set stage_changed_at = now() - interval '1 day' where id='${L("01")}';`);
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}', owner_kind='user' where id='${L("01")}';`);
    expect(etapa(L("01"))).toBe(PARA_ATENDER);
    expect(linhas(L("01"))).toBe("1");
    expect(eventos(L("01"))).toBe("1");
    expect(valor(`select (stage_changed_at > now() - interval '1 minute')::text from public.crm_leads where id='${L("01")}';`)).toBe("true");
    expect(
      valor(`select payload->>'from_stage_id' from public.crm_lead_activities where lead_id='${L("01")}' and metadata->>'origem'='gatilho_0648';`),
    ).toBe(IA);
  });

  it("para quem NÃO é vendedor (a SDR): fica onde está", () => {
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_B}', owner_kind='user' where id='${L("02")}';`);
    expect(etapa(L("02"))).toBe(IA);
    expect(linhas(L("02"))).toBe("0");
  });

  it("a etapa já DEPOIS da coluna: só para a frente, fica", () => {
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}', owner_kind='user' where id='${L("03")}';`);
    expect(etapa(L("03"))).toBe(EM_ATENDIMENTO);
  });

  it("a MESMA escrita já escolhe a etapa: ela manda", () => {
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}', owner_kind='user', stage_id='${EM_ATENDIMENTO}' where id='${L("04")}';`);
    expect(etapa(L("04"))).toBe(EM_ATENDIMENTO);
    expect(linhas(L("04"))).toBe("0");
  });

  it("com o sinal administrativo (0647): não move", () => {
    sql(`begin; set local iavek.mudanca_administrativa = 'sim';
         update public.crm_leads set owner_user_id='${GOV_AGENT_A}', owner_kind='user' where id='${L("05")}'; commit;`);
    expect(etapa(L("05"))).toBe(IA);
  });

  it("o funil SEM a config: nada muda (o produto não tem org fixa)", () => {
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}', owner_kind='user' where id='${L("06")}';`);
    expect(etapa(L("06"))).toBe(SEM_IA);
  });

  it("o lead fechado: não move", () => {
    sql(`update public.crm_leads set status='won', closed_at=now() where id='${L("07")}';`);
    sql(`update public.crm_leads set owner_user_id='${GOV_AGENT_A}', owner_kind='user' where id='${L("07")}';`);
    expect(etapa(L("07"))).toBe(IA);
  });

  it("o lead que NASCE com um vendedor de dono também vai, com a linha do tempo", () => {
    const id = L("08");
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, owner_user_id, owner_kind)
         values ('${id}', '${GOV_ORG}', '${FUNIL}', '${IA}', 'Nasce 0648', '${GOV_AGENT_A}', 'user') on conflict (id) do nothing;`);
    expect(etapa(id)).toBe(PARA_ATENDER);
    expect(linhas(id)).toBe("1");
  });
});
