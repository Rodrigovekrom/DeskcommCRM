import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_AGENT_B, GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.22 (0610) — o aviso do grupo casa pelo telefone, o nome só desempata ou acha um
 * único lead em IA Atendendo; move para Suporte IA e entrega ao guardião que recebeu há mais tempo.
 */
const N = "eeeeeeee-0610-4000-8000-000000000";
const FUNIL = `${N}002`;
const NOVO = `${N}003`;
const SUPORTE = `${N}004`;
const C1 = `${N}011`;
const C2 = `${N}012`;
const C3 = `${N}013`;
const C4 = `${N}014`;
const L1 = `${N}021`;
const L2 = `${N}022`;
const L3 = `${N}023`;
const L4 = `${N}024`;

const aviso = (telefones: string[], nome: string | null) =>
  lastLine(
    sql(`select resultado || '|' || coalesce(user_id::text, '-') || '|' || coalesce(metodo, '-')
           from public.fn_iavek_aviso_de_ajuda('${GOV_ORG}', array[${telefones.map((t) => `'${t}'`).join(",")}]::text[], ${nome ? `'${nome}'` : "null"});`),
  );
const lead = (id: string) => lastLine(sql(`select s.slug || '|' || coalesce(l.owner_user_id::text, '-') from public.crm_leads l join public.crm_stages s on s.id = l.stage_id where l.id = '${id}'`));

describe("0610 — aviso de ajuda do grupo", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      update public.crm_pipelines set is_default = false where organization_id = '${GOV_ORG}';
      insert into public.crm_pipelines (id, organization_id, name, slug, is_default) values ('${FUNIL}', '${GOV_ORG}', 'Funil 0610', 'funil-0610', true) on conflict (id) do update set is_default = true;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${NOVO}', '${GOV_ORG}', '${FUNIL}', 'IA Atendendo', 'novo', 1),
        ('${SUPORTE}', '${GOV_ORG}', '${FUNIL}', 'Suporte IA', 'em-atendimento-ia', 2) on conflict (id) do nothing;
      insert into public.contacts (id, organization_id, name, phone_number) values
        ('${C1}', '${GOV_ORG}', 'Ana Prova', '+5511987650001'),
        ('${C2}', '${GOV_ORG}', 'Bia Prova', '+551187650002'),
        ('${C3}', '${GOV_ORG}', 'Caio Sem Telefone', null),
        ('${C4}', '${GOV_ORG}', 'Dani Com Dono', '+5511987650004') on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id, owner_user_id, owner_kind) values
        ('${L1}', '${GOV_ORG}', '${FUNIL}', '${NOVO}', 'L1', 1, '${C1}', null, null),
        ('${L2}', '${GOV_ORG}', '${FUNIL}', '${NOVO}', 'L2', 2, '${C2}', null, null),
        ('${L3}', '${GOV_ORG}', '${FUNIL}', '${NOVO}', 'L3', 3, '${C3}', null, null),
        ('${L4}', '${GOV_ORG}', '${FUNIL}', '${NOVO}', 'L4', 4, '${C4}', '${GOV_AGENT_B}', 'user') on conflict (id) do nothing;
      update public.user_organizations set role = 'agent', interface_settings = coalesce(interface_settings, '{}'::jsonb) || '{"funcao":"sdr"}'::jsonb
        where organization_id = '${GOV_ORG}' and user_id in ('${GOV_AGENT_A}', '${GOV_AGENT_B}');
    `);
  });

  it("telefone não casa e nome não casa: não reconhecido, nada se move", () => {
    expect(aviso(["5511900009999"], "Ninguém")).toBe("nao_reconhecido|-|-");
    expect(lead(L1)).toBe("novo|-");
  });

  it("telefone com 9 e com 55 casa o contato gravado com 9", () => {
    const r = aviso(["11987650001", "5511987650001", "1187650001", "551187650001"], "Ana Prova");
    expect(r).toMatch(/^entregue\|.+\|telefone$/);
    expect(lead(L1)).toMatch(/^em-atendimento-ia\|/);
    expect(lead(L1)).not.toMatch(/\|-$/);
  });

  it("o contato gravado sem o 9 também casa, e o rodízio passa ao outro guardião", () => {
    const primeiro = lead(L1).split("|")[1];
    const r = aviso(["11987650002", "5511987650002", "1187650002", "551187650002"], null);
    expect(r).toMatch(/^entregue\|/);
    expect(r.split("|")[1]).not.toBe(primeiro);
  });

  it("sem telefone que case, o nome acha o lead único em IA Atendendo", () => {
    expect(aviso([], "caio sem telefone")).toMatch(/^entregue\|.+\|nome$/);
    expect(lead(L3)).toMatch(/^em-atendimento-ia\|/);
  });

  it("lead que já tem dono não muda de mão nem de etapa", () => {
    expect(aviso(["5511987650004"], "Dani Com Dono")).toBe(`ja_tem_dono|${GOV_AGENT_B}|telefone`);
    expect(lead(L4)).toBe(`novo|${GOV_AGENT_B}`);
  });

  it("sem guardião ativo, fica em Suporte IA sem dono (vai para a faixa)", () => {
    sql(`update public.user_organizations set interface_settings = interface_settings - 'funcao' where organization_id = '${GOV_ORG}' and user_id in ('${GOV_AGENT_A}', '${GOV_AGENT_B}');
         insert into public.contacts (id, organization_id, name, phone_number) values ('${N}015', '${GOV_ORG}', 'Edu', '+5511987650005') on conflict (id) do nothing;
         insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id) values ('${N}025', '${GOV_ORG}', '${FUNIL}', '${NOVO}', 'L5', 5, '${N}015') on conflict (id) do nothing;`);
    expect(aviso(["5511987650005"], null)).toBe("sem_guardiao|-|telefone");
    expect(lead(`${N}025`)).toBe("em-atendimento-ia|-");
  });

  it("só o servidor chama", () => {
    for (const papel of ["anon", "authenticated"]) {
      expect(lastLine(sql(`select has_function_privilege('${papel}', 'public.fn_iavek_aviso_de_ajuda(uuid,text[],text)', 'execute')`))).toBe("f");
    }
  });
});
