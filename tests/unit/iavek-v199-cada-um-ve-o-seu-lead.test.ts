import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bytesBatemComOTipo } from "@/lib/iavek/fichas";
import { podePassarOLead } from "@/lib/iavek/sdr-marca-direto";

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


describe("v1.9.9-seg (parte 2) — as rotas que usam a chave de serviço", () => {
  it("B2: o SDR passa o lead sem dono, o dele e o que guarda; o de um colega, não", () => {
    expect(podePassarOLead({ owner_user_id: null, sdr_user_id: null }, "eu")).toBe(true);
    expect(podePassarOLead({ owner_user_id: "eu", sdr_user_id: null }, "eu")).toBe(true);
    expect(podePassarOLead({ owner_user_id: "vendedor", sdr_user_id: "eu" }, "eu")).toBe(true);
    expect(podePassarOLead({ owner_user_id: "colega", sdr_user_id: null }, "eu")).toBe(false);
    expect(podePassarOLead({ owner_user_id: "colega", sdr_user_id: "outro" }, "eu")).toBe(false);
    const rota = readFileSync("app/api/v1/iavek/pedidos-de-agendamento/route.ts", "utf8");
    expect(rota).toMatch(/!gerencia && !podePassarOLead\(negocio, authz\.user\.id\)/);
    // O negócio é lido pela SESSÃO, e a escrita pelo servidor só com o dono conferido.
    expect(rota).toMatch(/async function leadDoCliente\([^)]*\)[\s\S]{0,200}const sessao = await createClient\(\)/);
    expect(rota).toMatch(/peloServidor\.eq\("owner_user_id", lead\.owner_user_id\) : peloServidor\.is\("owner_user_id", null\)/);
  });

  it("B3: a passagem (GET e POST) responde 404 a quem não enxerga o lead", () => {
    const rota = readFileSync("app/api/v1/iavek/passagem/route.ts", "utf8");
    expect(rota.match(/leadVisivelPelaSessao\(authz\.org\.orgId, /g)?.length).toBe(2);
  });

  it("D5: trocar o dono pelo servidor só com o dono que a rota conferiu", () => {
    const f = readFileSync("lib/iavek/passagem-servidor.ts", "utf8");
    expect(f).toMatch(/args\.donoAnterior \? consulta\.eq\("owner_user_id", args\.donoAnterior\) : consulta\.is\("owner_user_id", null\)/);
    const rota = readFileSync("app/api/v1/iavek/passagem/route.ts", "utf8");
    expect(rota.match(/donoAnterior: lead\.owner_user_id/g)?.length).toBe(3);
  });

  it("B4: as fichas passam pelo portão (MFA, org suspensa, aba, auditoria) e o papel vem do banco", () => {
    const f = readFileSync("lib/iavek/fichas.ts", "utf8");
    expect(f).toContain("await portaoSemPapel(");
    expect(f).toContain('rpc("fn_user_role_in_org"');
    expect(f).not.toContain("resolveActiveOrg");
    const portao = readFileSync("lib/auth/require-role.ts", "utf8");
    const corpo = portao.slice(portao.indexOf("export async function portaoSemPapel("));
    for (const etapa of ["orgAtivaSemPortao(user)", "orgDaAbaNoHeader()", "ehOperante(org.org_status)", "mfaEmDivida()", '"authz.denied"']) {
      expect(corpo).toContain(etapa);
    }
  });

  it("B8: o documento da ficha só entra se os bytes forem do formato declarado", () => {
    const bytes = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0)]);
    const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
    expect(bytesBatemComOTipo("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(bytesBatemComOTipo("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(bytesBatemComOTipo("application/pdf", bytes(...ascii("%PDF-1.7")))).toBe(true);
    expect(bytesBatemComOTipo("image/webp", bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toBe(true);
    expect(bytesBatemComOTipo("image/heic", bytes(0, 0, 0, 24, ...ascii("ftypheic")))).toBe(true);
    // Um HTML (ou um executável) que se diz PDF ou JPG.
    expect(bytesBatemComOTipo("application/pdf", bytes(...ascii("<html>")))).toBe(false);
    expect(bytesBatemComOTipo("image/jpeg", bytes(0x4d, 0x5a))).toBe(false);
    expect(bytesBatemComOTipo("text/html", bytes(...ascii("%PDF-")))).toBe(false);
  });

  it("D1: o Meu dia busca só a janela do relógio, não os mais velhos com corte", () => {
    const rota = readFileSync("app/api/v1/iavek/meu-dia/route.ts", "utf8");
    expect(rota).toMatch(/\.gte\("created_at", new Date\(agora\.getTime\(\) - \(entrada\.horas \+ 24\) \* 3_600_000\)/);
  });
});

describe("v1.9.9-seg — a trava aceita as regras do próprio sistema (medido no canário com a v1.9.7)", () => {
  it("o guardião que ASSUME vira guardião (sem isto, o Assumir dava 500)", () => {
    const f = ultima("create or replace function public.fn_iavek_trava_guardiao_do_lead(");
    expect(f).toMatch(
      /new\.sdr_user_id is not distinct from new\.owner_user_id[\s\S]{0,200}fn_iavek_funcao_do_membro\(new\.organization_id, new\.owner_user_id\), ''\) = 'sdr'/,
    );
  });
  it("o guardião que cria o PRÓPRIO lead é guardião dele, só se o contato não for de outra pessoa", () => {
    const f = ultima("create or replace function public.fn_iavek_trava_guardiao_do_lead(");
    expect(f).toMatch(/l\.status = 'open' and l\.owner_user_id is not null and l\.owner_user_id <> v_eu/);
    expect(f).toMatch(/c\.assigned_to_user_id is not null and c\.assigned_to_user_id <> v_eu/);
  });
});
