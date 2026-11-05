import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, lastLine, seedGov, sql } from "./gov-helpers";

/**
 * ia.vek v1.9.12 (0600) — o Altimus manda no valor do lead ABERTO, o vendido nunca
 * muda, e o aviso da loja sai uma vez por ciclo do carro, só com o carro.
 */
const N = "eeeeeeee-0600-4000-8000-000000000";
const CARRO = `${N}001`;
const FUNIL = `${N}002`;
const ABERTA = `${N}003`;
const VENDIDO = `${N}004`;
const LEAD = `${N}005`;

const valor = () => Number(lastLine(sql(`select value_cents from public.crm_leads where id = '${LEAD}';`)));
const aviso = (evento: string) =>
  Number(lastLine(sql(`select public.fn_iavek_aviso_da_loja('${GOV_ORG}', '${evento}', '${CARRO}');`)));

describe("0600 — o estoque manda no lead aberto", () => {
  beforeAll(() => {
    seedGov();
    sql(`
      insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents, moeda, origem)
        values ('${CARRO}', '${GOV_ORG}', 'ALT-0600', 'Carro da prova', 8000000, 'BRL', 'altimus')
        on conflict (id) do nothing;
      insert into public.crm_pipelines (id, organization_id, name, slug) values ('${FUNIL}', '${GOV_ORG}', 'Funil 0600', 'funil-0600')
        on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
        values ('${ABERTA}', '${GOV_ORG}', '${FUNIL}', 'Aberta', 'aberta', 1) on conflict (id) do nothing;
      insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position, is_won)
        values ('${VENDIDO}', '${GOV_ORG}', '${FUNIL}', 'Vendido', 'vendido', 2, true) on conflict (id) do nothing;
      insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, value_cents, position_in_stage, custom_fields)
        values ('${LEAD}', '${GOV_ORG}', '${FUNIL}', '${ABERTA}', 'Lead 0600', 111, 1,
                '{"carro_interesse": "${CARRO}"}') on conflict (id) do nothing;
    `);
  });

  it("nasce com o preço, e valor digitado não fica", () => {
    expect(valor()).toBe(8000000);
    sql(`update public.crm_leads set value_cents = 222 where id = '${LEAD}';`);
    expect(valor()).toBe(8000000);
  });

  it("o preço muda no Altimus e o lead aberto acompanha", () => {
    sql(`update public.catalog_products set preco_cents = 8100000 where id = '${CARRO}';`);
    expect(valor()).toBe(8100000);
  });

  it("vendido fica com o valor final e a data, e guarda o preço à parte", () => {
    sql(`update public.crm_leads set stage_id = '${VENDIDO}', value_cents = 7500000,
           closed_at = '2026-10-20T15:00:00Z' where id = '${LEAD}';`);
    sql(`update public.catalog_products set preco_cents = 9000000 where id = '${CARRO}';`);
    expect(valor()).toBe(7500000);
    expect(
      lastLine(sql(`select status || '|' || preco_estoque_na_venda_cents || '|' ||
        to_char(closed_at at time zone 'UTC', 'YYYY-MM-DD') from public.crm_leads where id = '${LEAD}';`)),
    ).toBe("won|8100000|2026-10-20");
  });

  it("o aviso: um por ciclo, só com o carro, e o ciclo recomeça quando o carro volta", () => {
    const membros = Number(lastLine(sql(`select count(*) from public.user_organizations
      where organization_id = '${GOV_ORG}' and revoked_at is null and accepted_at is not null;`)));
    expect(membros).toBeGreaterThan(0);
    // v1.9.19 (0606): a venda do teste anterior já levou o carimbo. Aqui, o ciclo novo.
    sql(`update public.catalog_products set aviso_da_loja_em = null where id = '${CARRO}';`);
    expect(aviso("carro_saiu")).toBe(membros);
    expect(aviso("carro_saiu")).toBe(0);
    expect(aviso("carro_vendido")).toBe(0);
    expect(
      lastLine(sql(`select count(*) from public.notificacoes where tipo = 'aviso_da_loja'
        and organization_id = '${GOV_ORG}' and (lead_id is not null or dados - 'evento' - 'carro_id' - 'carro_nome' <> '{}');`)),
    ).toBe("0");
    sql(`update public.catalog_products set ativo = false where id = '${CARRO}';
         update public.catalog_products set ativo = true where id = '${CARRO}';`);
    expect(aviso("carro_saiu")).toBe(membros);
  });

  it("feed parcial: um aviso resumido, só com a quantidade, e todos os carimbos", () => {
    const CARROS = [`${N}011`, `${N}012`, `${N}013`];
    sql(CARROS.map((id, i) => `insert into public.catalog_products (id, organization_id, codigo, nome, preco_cents, moeda, origem, ativo)
      values ('${id}', '${GOV_ORG}', 'ALT-06${i}', 'Carro ${i}', 100, 'BRL', 'altimus', false) on conflict (id) do nothing;`).join("\n"));
    const lista = `array[${CARROS.map((c) => `'${c}'`).join(",")}]::uuid[]`;
    const membros = Number(lastLine(sql(`select public.fn_iavek_aviso_resumido_da_loja('${GOV_ORG}', ${lista});`)));
    expect(membros).toBeGreaterThan(0);
    expect(lastLine(sql(`select public.fn_iavek_aviso_resumido_da_loja('${GOV_ORG}', ${lista});`))).toBe("0");
    expect(lastLine(sql(`select count(*) from public.catalog_products where id = any(${lista}) and aviso_da_loja_em is not null;`))).toBe("3");
    expect(lastLine(sql(`select count(*) || '|' || min(dados->>'quantidade') from public.notificacoes
      where tipo = 'aviso_da_loja' and dados->>'evento' = 'carros_sairam' and organization_id = '${GOV_ORG}';`))).toBe(`${membros}|3`);
  });

  it("na dona do estoque, nenhum caminho vende sem valor e data; reabrir e reordenar passam", () => {
    const LEAD2 = `${N}021`;
    sql(`insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, title, value_cents, position_in_stage)
      values ('${LEAD2}', '${GOV_ORG}', '${FUNIL}', '${ABERTA}', 'Lead 2', 500, 2) on conflict (id) do nothing;`);
    expect(() => sql(`update public.crm_leads set stage_id = '${VENDIDO}' where id = '${LEAD2}';`)).toThrow(/venda_incompleta/);
    expect(() => sql(`update public.crm_leads set stage_id = '${VENDIDO}', closed_at = now(), value_cents = 0 where id = '${LEAD2}';`)).toThrow(/venda_incompleta/);
    expect(() => sql(`insert into public.crm_leads (organization_id, pipeline_id, stage_id, title, position_in_stage)
      values ('${GOV_ORG}', '${FUNIL}', '${VENDIDO}', 'Nasce vendido', 3);`)).toThrow(/venda_incompleta/);
    sql(`update public.crm_leads set stage_id = '${VENDIDO}', closed_at = now() where id = '${LEAD2}';`);
    expect(lastLine(sql(`select status from public.crm_leads where id = '${LEAD2}';`))).toBe("won");
    sql(`update public.crm_leads set position_in_stage = 9 where id = '${LEAD2}';`);
    sql(`update public.crm_leads set stage_id = '${ABERTA}' where id = '${LEAD2}';`);
    expect(lastLine(sql(`select status from public.crm_leads where id = '${LEAD2}';`))).toBe("open");
  });

  it("sessão de usuário não dispara o aviso", () => {
    expect(() =>
      sql(`set role authenticated; select public.fn_iavek_aviso_da_loja('${GOV_ORG}', 'carro_saiu', '${CARRO}');`),
    ).toThrow(/permission denied/);
  });
});
