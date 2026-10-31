import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ia.vek v1.9.9-seg (0598) — "cada um vê o seu lead". A prova de comportamento é
 * por JWT real no banco de teste (provas/prova-seg, fora do repo); aqui a cerca
 * prende a forma no baseline que o kit aplica, ancorada na ÚLTIMA definição
 * (regra 10 da doutrina de migrations).
 */
const base = readFileSync("supabase/baseline.sql", "utf8");
const ultima = (inicio: string) => {
  const i = base.lastIndexOf(inicio);
  expect(i, inicio).toBeGreaterThan(-1);
  return base.slice(i, base.indexOf("$$;", i) + 3);
};
const policy = (nome: string) => {
  const i = base.lastIndexOf(`create policy "${nome}"`);
  expect(i, nome).toBeGreaterThan(-1);
  return base.slice(i, base.indexOf(";\n", i));
};

describe("v1.9.9-seg — a visibilidade conhece a função do membro", () => {
  it("vendedor = só o dele; Suporte IA = + sem dono; guardião = + sem dono só com a chave ligada; sem função = a org", () => {
    const modo = ultima("create or replace function public.fn_iavek_modo_da_funcao(");
    expect(modo).toMatch(/when 'vendedor' then 'own'/);
    expect(modo).toMatch(/when 'suporte' then 'own_and_unassigned'/);
    expect(modo).toMatch(/'guardiao_ve_sem_dono'[\s\S]*'true'\) = 'false'[\s\S]*then 'own' else 'own_and_unassigned'/);
    expect(modo).toMatch(/else null/);
  });

  it("leads e conversas usam o modo da função ANTES do visibility_mode da organização", () => {
    for (const f of ["fn_can_view_lead(", "fn_can_view_conversation(", "fn_iavek_visao_de_conversas("]) {
      expect(ultima(`create or replace function public.${f}`)).toMatch(
        /coalesce\(\s*public\.fn_iavek_modo_da_funcao\([^)]*\),[\s\S]*visibility_mode/,
      );
    }
  });

  it("o SELECT de leads é por consulta (conjunto), com o guardião vendo o que passou", () => {
    const p = policy("crm_leads_select");
    expect(p).toContain("fn_iavek_visao_de_conversas()");
    expect(p).toMatch(/sdr_user_id = \(select auth\.uid\(\)\)/);
    expect(p).not.toContain("fn_can_view_lead(");
  });

  it("as funções novas não ficam expostas à anon", () => {
    for (const f of ["fn_iavek_funcao_na_org(uuid)", "fn_iavek_modo_da_funcao(uuid)"]) {
      expect(base).toContain(`revoke execute on function public.${f} from public, anon;`);
    }
  });
});

describe("v1.9.9-seg — as travas", () => {
  it("guardião e contato do lead: só a gerência ou o sistema; sem `=` que vira nulo", () => {
    const f = ultima("create or replace function public.fn_iavek_trava_guardiao_do_lead(");
    expect(f).toContain("pg_trigger_depth() > 1");
    expect(f).toContain("fn_role_at_least(new.organization_id, 'manager')");
    expect(f).toContain("new.contact_id is distinct from old.contact_id");
    // O defeito medido: `old.owner_user_id = v_eu` com dono NULO deixava o `if` sem disparar.
    expect(f).not.toMatch(/old\.owner_user_id = v_eu|new\.sdr_user_id = v_eu|old\.sdr_user_id = v_eu/);
    expect(base).toMatch(/create trigger trg_zz_iavek_trava_guardiao_do_lead\s+before insert or update of sdr_user_id, contact_id, owner_user_id on public\.crm_leads/);
  });

  it("o responsável da conversa é membro ativo", () => {
    const f = ultima("create or replace function public.fn_iavek_responsavel_e_membro(");
    expect(f).toContain("uo.revoked_at is null");
    expect(base).toMatch(/create trigger trg_iavek_responsavel_e_membro\s+before update of assigned_to_user_id on public\.conversations/);
  });

  it("apagar conversa é de gerente+; lgpd-exports só admin lê; ai-policy só gerente+ escreve", () => {
    expect(policy("conversations_agent_delete")).toContain("fn_role_at_least(organization_id, 'manager')");
    expect(policy("tenant_read_lgpd_exports")).toContain("'admin')");
    expect(policy("tenant_write_ai_policy")).toContain("'manager')");
    expect(policy("tenant_delete_ai_policy")).toContain("'manager')");
  });
});
