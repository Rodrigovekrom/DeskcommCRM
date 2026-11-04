import { beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_A, GOV_CONTACT_1, GOV_MANAGER, GOV_ORG, lastLine, seedGov, sql, writeCountAs } from "./gov-helpers";

/**
 * ia.vek v1.9.19 (0606) — o aviso de venda sai uma vez, sem cliente e sem valor, e usa
 * o carimbo do carro; só gerente e admin corrigem o vendido; Agendado exige horário;
 * e nada disso vale para clínica.
 */
const N = "eeeeeeee-0606-4000-8000-000000000";
const CARRO = `${N}001`;
const FUNIL = `${N}002`;
const ABERTA = `${N}003`;
const VENDIDO = `${N}004`;
const AGENDADO = `${N}005`;
const LEAD = `${N}006`;
const LEAD2 = `${N}007`;

const um = (q: string) => lastLine(sql(q));
const avisos = () =>
  Number(um(`select count(*) from public.notificacoes where organization_id='${GOV_ORG}' and tipo='aviso_da_loja' and dados->>'evento'='venda';`));
const nicho = (n: string | null) =>
  sql(`update public.organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{iavek}',
    coalesce(settings->'iavek','{}'::jsonb) || ${n ? `'{"perfil":{"nicho":"${n}"}}'::jsonb` : `'{}'::jsonb`}) where id='${GOV_ORG}';`);
const moverComo = (u: string, lead: string, etapa: string): string => {
  try {
    return String(writeCountAs(u, `update public.crm_leads set stage_id='${etapa}' where id='${lead}'`));
  } catch (e) {
    return String((e as Error).message + String((e as { stderr?: unknown }).stderr ?? ""));
  }
};

describe("0606 — venda e Agendado", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      update public.user_organizations set role='agent', interface_settings='{"funcao":"vendedor"}' where organization_id='${GOV_ORG}' and user_id='${GOV_AGENT_A}';
      insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents, moeda, origem)
        values ('${CARRO}', '${GOV_ORG}', 'ALT-0606', 'Carro da prova 0606', 8000000, 'BRL', 'altimus') on conflict (id) do nothing;
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${GOV_ORG}', 'Funil 0606', 'funil-0606') on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position) values
        ('${ABERTA}', '${GOV_ORG}', '${FUNIL}', 'Aberta', 'aberta-0606', 1),
        ('${AGENDADO}', '${GOV_ORG}', '${FUNIL}', 'Agendado', 'agendado-video', 2) on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won)
        values ('${VENDIDO}', '${GOV_ORG}', '${FUNIL}', 'Vendido', 'vendido-0606', 3, true) on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, position_in_stage, contact_id, owner_user_id, owner_kind, custom_fields) values
        ('${LEAD}', '${GOV_ORG}', '${FUNIL}', '${ABERTA}', 'Cliente Secreto', 1, '${GOV_CONTACT_1}', '${GOV_AGENT_A}', 'user', '{"carro_interesse": "${CARRO}"}'),
        ('${LEAD2}', '${GOV_ORG}', '${FUNIL}', '${ABERTA}', 'Lead dois', 2, '${GOV_CONTACT_1}', '${GOV_AGENT_A}', 'user', '{}') on conflict (id) do nothing;
    `);
  });

  it("Agendado sem horário: a pessoa é recusada; com pedido futuro, move", () => {
    expect(moverComo(GOV_AGENT_A, LEAD2, AGENDADO)).toMatch(/agendado_sem_horario/);
    sql(`insert into public.iavek_pedidos_de_agendamento (organization_id, contact_id, lead_id, quando, status, pedido_por, origem)
         values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${LEAD2}', now() + interval '1 day', 'pendente', '${GOV_AGENT_A}', 'pessoa');`);
    expect(moverComo(GOV_AGENT_A, LEAD2, AGENDADO)).toBe("1");
  });

  it("pedido recusado ou no passado não conta", () => {
    sql(`update public.crm_leads set stage_id='${ABERTA}' where id='${LEAD2}';
         update public.iavek_pedidos_de_agendamento set status='recusado' where lead_id='${LEAD2}';`);
    expect(moverComo(GOV_AGENT_A, LEAD2, AGENDADO)).toMatch(/agendado_sem_horario/);
  });

  it("na clínica nada muda: nem Agendado, nem aviso, nem correção", () => {
    nicho("clinica");
    const antes = avisos();
    expect(moverComo(GOV_AGENT_A, LEAD2, AGENDADO)).toBe("1");
    sql(`update public.crm_leads set stage_id='${VENDIDO}', value_cents=100, closed_at=now() where id='${LEAD2}';`);
    expect(avisos()).toBe(antes);
    expect(writeCountAs(GOV_AGENT_A, `update public.crm_leads set value_cents=200 where id='${LEAD2}'`)).toBe(1);
    nicho("loja_de_carros");
  });

  it("a venda avisa todos os membros ativos, uma vez, só com o carro", () => {
    const membros = Number(um(`select count(*) from public.user_organizations where organization_id='${GOV_ORG}' and revoked_at is null and accepted_at is not null;`));
    const antes = avisos();
    sql(`update public.crm_leads set stage_id='${VENDIDO}', value_cents=7500000, closed_at='2026-10-20T15:00:00Z' where id='${LEAD}';`);
    expect(avisos() - antes).toBe(membros);
    expect(um(`select dados->>'carro_nome' from public.notificacoes where organization_id='${GOV_ORG}' and dados->>'evento'='venda' and dados->>'carro_id'='${CARRO}' limit 1;`)).toBe("Carro da prova 0606");
    expect(Number(um(`select count(*) from public.notificacoes where organization_id='${GOV_ORG}' and dados->>'evento'='venda' and (lead_id is not null or dados::text ilike '%secreto%' or dados::text ilike '%7500000%');`))).toBe(0);
    expect(um(`select ator_user_id from public.notificacoes where organization_id='${GOV_ORG}' and dados->>'carro_id'='${CARRO}' limit 1;`)).toBe(GOV_AGENT_A);
  });

  it("o carro vendido que sai do Altimus não gera segundo aviso; o que volta, sim", () => {
    expect(Number(um(`select public.fn_iavek_aviso_da_loja('${GOV_ORG}', 'carro_saiu', '${CARRO}');`))).toBe(0);
    sql(`update public.catalog_products set ativo=false where id='${CARRO}'; update public.catalog_products set ativo=true where id='${CARRO}';`);
    expect(um(`select aviso_da_loja_em is null from public.catalog_products where id='${CARRO}';`)).toBe("t");
  });

  it("depois de vendido: vendedor dono é recusado, gerente corrige", () => {
    let erro = "";
    try {
      writeCountAs(GOV_AGENT_A, `update public.crm_leads set value_cents=1 where id='${LEAD}'`);
    } catch (e) {
      erro = String((e as Error).message + String((e as { stderr?: unknown }).stderr ?? ""));
    }
    expect(erro).toMatch(/venda_so_gerente/);
    expect(writeCountAs(GOV_MANAGER, `update public.crm_leads set value_cents=7000000 where id='${LEAD}'`)).toBe(1);
    expect(um(`select value_cents from public.crm_leads where id='${LEAD}';`)).toBe("7000000");
  });

  it("gerente não põe data no futuro nem zera o valor", () => {
    for (const set of [`closed_at=now()+interval '2 days'`, `value_cents=0`]) {
      let erro = "";
      try {
        writeCountAs(GOV_MANAGER, `update public.crm_leads set ${set} where id='${LEAD}'`);
      } catch (e) {
        erro = String((e as Error).message + String((e as { stderr?: unknown }).stderr ?? ""));
      }
      expect(erro).toMatch(/venda_data_invalida|venda_incompleta/);
    }
  });
});
