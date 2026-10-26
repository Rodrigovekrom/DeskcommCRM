import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { escolherOrgDona, novaEmpresaPararia } from "@/lib/estoque/org-dona";
import { CAMPOS_SEMPRE_VISIVEIS, camposSempreVisiveis } from "@/lib/iavek/barra-lateral";
import {
  CRITERIOS_PADRAO,
  CRITERIOS_PADRAO_CLINICA,
  criteriosPadrao,
  promptDoAvaliador,
} from "@/lib/iavek/nota-do-atendimento";
import {
  PERFIL_PADRAO,
  comPerfilDaEmpresa,
  ehLojaDeCarros,
  lerPerfilDaEmpresa,
  type PerfilDaEmpresa,
} from "@/lib/iavek/perfil-da-empresa";
import { createTenantSchema } from "@/lib/schemas/tenant-creation";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

let perfil: PerfilDaEmpresa = { ...PERFIL_PADRAO };
vi.mock("@/hooks/iavek/usePerfilDaEmpresa", () => ({
  usePerfilDaEmpresa: () => ({ ...perfil, lojaDeCarros: perfil.nicho === "loja_de_carros" }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/iavek/CamposObrigatorios", () => ({
  useCamposQueFaltam: () => ({ data: undefined }),
  SeloIncompleto: () => null,
}));
vi.mock("@/components/contacts/CampoDoCatalogo", () => ({ useNomeDoCarro: () => "Onix 2020" }));

const { ResumoNaBarra } = await import("@/components/iavek/ResumoNaBarra");
const { PassarFicha } = await import("@/components/iavek/PassarFicha");

/** ia.vek v1.9.0 — o perfil da empresa (loja de carros x clínica). */
describe("v1.9.0 — perfil da empresa", () => {
  it("ausente ou inválido vale LOJA DE CARROS sem modo agendamento (a Fenômenos não muda)", () => {
    expect(lerPerfilDaEmpresa(null)).toEqual(PERFIL_PADRAO);
    expect(lerPerfilDaEmpresa({})).toEqual(PERFIL_PADRAO);
    expect(lerPerfilDaEmpresa({ iavek: { rodizio: { ativo: true } } })).toEqual(PERFIL_PADRAO);
    expect(lerPerfilDaEmpresa({ iavek: { perfil: { nicho: "padaria", modo_agendamento: true } } })).toEqual(PERFIL_PADRAO);
    expect(lerPerfilDaEmpresa({ iavek: { perfil: { nicho: "clinica" } } })).toEqual(PERFIL_PADRAO);
    expect(PERFIL_PADRAO).toEqual({ nicho: "loja_de_carros", modo_agendamento: false });
    expect(ehLojaDeCarros(null)).toBe(true);
  });

  it("lê a clínica e grava sem perder as outras chaves do ia.vek", () => {
    const antes = { visibility_mode: "x", iavek: { nota_do_atendimento: { ativo: true }, rodizio: { ativo: false } } };
    const depois = comPerfilDaEmpresa(antes, { nicho: "clinica", modo_agendamento: true });
    expect(depois).toEqual({
      visibility_mode: "x",
      iavek: { nota_do_atendimento: { ativo: true }, rodizio: { ativo: false }, perfil: { nicho: "clinica", modo_agendamento: true } },
    });
    expect(lerPerfilDaEmpresa(depois)).toEqual({ nicho: "clinica", modo_agendamento: true });
    expect(ehLojaDeCarros(lerPerfilDaEmpresa(depois))).toBe(false);
  });

  it("o layout de /app entrega o perfil à tela, lido da mesma linha de settings", () => {
    expect(ler("app/app/layout.tsx")).toContain("iavek_perfil: lerPerfilDaEmpresa(orgRow?.settings),");
  });
});

describe("v1.9.0 — telas de carro só na loja de carros", () => {
  beforeEach(() => {
    perfil = { ...PERFIL_PADRAO };
  });

  it("a barra lateral da loja segue IGUAL; a da clínica sai sem carro, pagamento e parcela", () => {
    expect(camposSempreVisiveis(true)).toBe(CAMPOS_SEMPRE_VISIVEIS);
    expect([...camposSempreVisiveis(false)]).toEqual(["nome", "telefone", "etapa", "vendedor", "guardiao", "tags", "observacoes"]);
  });

  const lead = {
    id: "l1",
    updated_at: "2026-10-26T00:00:00Z",
    custom_fields: { carro_interesse: "p1", forma_pagamento: "a_vista", parcela_desejavel: 900 },
    tags: [],
  } as never;

  it("ResumoNaBarra: loja mostra 'Carro de interesse'; clínica não", () => {
    const { unmount } = render(<ResumoNaBarra nome="Ana" telefone={null} tagsDoContato={[]} lead={lead} observacoes={[]} />);
    expect(screen.getByText("Carro de interesse")).toBeTruthy();
    expect(screen.getByText("Onix 2020")).toBeTruthy();
    unmount();
    perfil = { nicho: "clinica", modo_agendamento: false };
    render(<ResumoNaBarra nome="Ana" telefone={null} tagsDoContato={[]} lead={lead} observacoes={[]} />);
    expect(screen.queryByText("Carro de interesse")).toBeNull();
    expect(screen.queryByText("Forma de pagamento")).toBeNull();
    expect(screen.queryByText("Parcela desejável")).toBeNull();
    expect(screen.getByText("Etapa do funil")).toBeTruthy();
  });

  it("Passar Ficha some na clínica", () => {
    perfil = { nicho: "clinica", modo_agendamento: false };
    const { container } = render(<PassarFicha leadId="l1" donoDoLead={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("cartão, faixa da compra, ficha do lead e Altimus perguntam ao perfil", () => {
    expect(ler("components/iavek/CartaoIavek.tsx")).toMatch(/\{lojaDeCarros && \(\s*<p className="truncate" data-testid="carro-de-interesse"/);
    expect(ler("components/iavek/DadosDaCompraNoCard.tsx")).toContain("if (!ligado || !lojaDeCarros) return null;");
    expect(ler("components/kanban/LeadDossier.tsx")).toMatch(/\{lojaDeCarros && \(\s*<div className="border-t border-border pt-3">\s*<h3[^>]*>\{t\("Ficha de crédito"\)\}/);
    expect(ler("app/app/settings/tenant/_altimus.tsx")).toContain("return lojaDeCarros ? <AltimusDaLoja /> : null;");
    expect(ler("app/api/v1/settings/altimus/route.ts")).toContain("if (parsed.data.ativa && !ehLojaDeCarros(lerPerfilDaEmpresa(minha?.settings)))");
  });
});

describe("v1.9.0 — a nota do atendimento fala de carro só na loja", () => {
  it("o texto da loja é o MESMO da v1.8.4 (padrão sem nicho = loja de carros)", () => {
    const loja = promptDoAvaliador("C");
    expect(loja).toBe(promptDoAvaliador("C", "loja_de_carros"));
    expect(loja.startsWith("Você avalia o ATENDIMENTO de um vendedor de uma loja de carros seminovos, pela conversa de WhatsApp.\n")).toBe(true);
    expect(loja).toContain("CRITÉRIOS DA LOJA:\nC");
    expect(criteriosPadrao("loja_de_carros")).toBe(CRITERIOS_PADRAO);
  });

  it("a clínica não recebe carro, troca nem pagamento", () => {
    const clinica = promptDoAvaliador("C", "clinica");
    expect(clinica).toContain("clínica de procedimentos");
    expect(clinica).toContain("CRITÉRIOS DA CLÍNICA:\nC");
    expect(clinica).not.toMatch(/carro|seminovo/i);
    expect(criteriosPadrao("clinica")).toBe(CRITERIOS_PADRAO_CLINICA);
    expect(CRITERIOS_PADRAO_CLINICA).not.toMatch(/carro|troca|estoque/i);
  });

  it("o worker passa o nicho da empresa ao avaliador e aos critérios", () => {
    const w = ler("workers/iavek-nota-do-atendimento.ts");
    expect(w).toContain("const { nicho } = lerPerfilDaEmpresa(");
    expect(w).toContain("lerCriteriosDoAcervo(admin, orgId, nicho)");
    expect(w).toContain("promptDoAvaliador(criterios.texto, nicho)");
  });
});

describe("v1.9.0 — a 2ª empresa não para o estoque da loja", () => {
  const loja = { id: "loja", settings: {} };
  const marcada = { id: "loja", settings: { integracoes: { altimus: { ativa: true } } } };
  const demo = { id: "demo", settings: {} };

  it("recusa só quando o Altimus está configurado e a loja é dona apenas por ser a única", () => {
    expect(novaEmpresaPararia(true, escolherOrgDona([loja]))).toBe(true);
    expect(novaEmpresaPararia(false, escolherOrgDona([loja]))).toBe(false);
    expect(novaEmpresaPararia(true, escolherOrgDona([marcada]))).toBe(false);
    expect(novaEmpresaPararia(true, escolherOrgDona([marcada, demo]))).toBe(false);
    expect(novaEmpresaPararia(true, escolherOrgDona([]))).toBe(false);
  });

  it("a criação pela tela e o provisionamento externo perguntam ANTES de criar", () => {
    const tela = ler("app/api/v1/admin/tenants/route.ts");
    expect(tela.indexOf("lojaQuePrecisaLigarOAltimus(")).toBeGreaterThan(0);
    expect(tela.indexOf("lojaQuePrecisaLigarOAltimus(")).toBeLessThan(tela.indexOf('admin.rpc("fn_create_tenant_with_owner"'));
    const externa = ler("app/api/v1/tenants/provision/route.ts");
    expect(externa.indexOf("lojaQuePrecisaLigarOAltimus(")).toBeGreaterThan(0);
    expect(externa.indexOf("lojaQuePrecisaLigarOAltimus(")).toBeLessThan(externa.indexOf("await provisionExternalTenant("));
  });

  it("o tipo de empresa é opcional na criação e não entra na função do banco", () => {
    expect(createTenantSchema.safeParse({ display_name: "AP", slug: "ap", owner_email: "a@b.co", iavek_nicho: "clinica" }).success).toBe(true);
    expect(createTenantSchema.safeParse({ display_name: "AP", slug: "ap", owner_email: "a@b.co", iavek_nicho: "padaria" }).success).toBe(false);
    expect(createTenantSchema.safeParse({ display_name: "AP", slug: "ap", owner_email: "a@b.co" }).success).toBe(true);
    expect(ler("app/api/v1/admin/tenants/route.ts")).toContain("const { iavek_nicho: nicho, ...pedido } = parsed.data;");
  });

  it("a loja que recebe o estoque não muda de tipo (rota do admin da plataforma)", () => {
    const r = ler("app/api/v1/admin/tenants/[id]/perfil-iavek/route.ts");
    expect(r).toContain("requirePlatformAdminEscrita()");
    expect(r).toMatch(/!ehLojaDeCarros\(parsed\.data\) && altimusDaOrg\(org\.settings\)\?\.ativa === true/);
    expect(r).toContain('action: "iavek.perfil_da_empresa_changed"');
  });
});
