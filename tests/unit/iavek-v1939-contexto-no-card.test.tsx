/**
 * ia.vek v1.9.39 (CRM-282, opção A, Rodrigo 10/11) — o contexto do lead no card.
 * Na loja: "Descrição" vira "Contexto do atendimento", com exemplo e o contador
 * "faltam X letras (mínimo 20)" na régua da trava (0612); "Dados do negócio" sobe
 * para antes da linha do tempo; "Editar campos" vira botão com quantos faltam.
 * Fora da loja (clínica): nada muda.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as renderRTL, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const perfil = vi.hoisted(() => ({ lojaDeCarros: true }));
vi.mock("@/hooks/iavek/usePerfilDaEmpresa", () => ({ usePerfilDaEmpresa: () => perfil }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useTagDeIdioma: () => "pt-BR" }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ role: "agent", currency: "BRL" }),
  useUser: () => ({ id: "u-vendedor", is_platform_admin: false }),
  useFuncaoVistaOpcional: () => null,
}));
vi.mock("@/hooks/leads/useLeadTimeline", () => ({
  useLeadTimeline: () => ({
    itens: [],
    chegouAoVivo: false,
    isLoading: false,
    isError: false,
    realtimeStatus: "SUBSCRIBED",
    seguranca: { divergencias: 0 },
  }),
}));
vi.mock("@/components/contacts/CampoDoCatalogo", () => ({ useValorVemDoEstoque: () => false }));
vi.mock("@/components/kanban/ConversaNoDossie", () => ({ ConversaNoDossie: () => null }));
vi.mock("@/components/kanban/ContatoDoNegocio", () => ({ ContatoDoNegocio: () => null }));
vi.mock("@/components/kanban/LeadTimeline", () => ({ LeadTimeline: () => <p data-testid="linha-do-tempo" /> }));
vi.mock("@/components/kanban/PropostasDoNegocio", () => ({ PropostasDoNegocio: () => null }));
vi.mock("@/components/iavek/CorrigirVenda", () => ({ CorrigirVenda: () => null }));
vi.mock("@/components/iavek/PassarFicha", () => ({ PassarFicha: () => null }));
vi.mock("@/components/iavek/SeloCarroIndisponivel", () => ({ SeloCarroIndisponivel: () => null }));
vi.mock("@/components/iavek/SeletorDeEtiquetas", () => ({ SeletorDeEtiquetas: () => null }));

import { IncompletosNoCardContext } from "@/components/iavek/CamposObrigatorios";
import { LeadDossier } from "@/components/kanban/LeadDossier";
import { LeadFieldsForm } from "@/components/kanban/LeadFieldsForm";
import { faltamParaOContexto } from "@/lib/iavek/contexto-do-lead";
import { CONTEXTO_MINIMO } from "@/lib/iavek/passagem";

const LEAD = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Rodrigo — SUV",
  description: null,
  value_cents: null,
  currency: "BRL",
  stage_id: "22222222-2222-4222-8222-222222222222",
  contact_id: "33333333-3333-4333-8333-333333333333",
  expected_close_date: null,
  tags: [],
  custom_fields: {},
  status: "open",
  owner_user_id: "u-vendedor",
} as never;

function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderRTL(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  perfil.lojaDeCarros = true;
});

describe("a régua do contexto é a mesma da trava (0612)", () => {
  it("20 letras, sem os espaços das pontas", () => {
    expect(CONTEXTO_MINIMO).toBe(20);
    expect(faltamParaOContexto("")).toBe(20);
    expect(faltamParaOContexto(null)).toBe(20);
    expect(faltamParaOContexto("   quer SUV   ")).toBe(12);
    expect(faltamParaOContexto("procura SUV até 80 mil")).toBe(0);
    expect(faltamParaOContexto("x".repeat(500))).toBe(0);
    // Como o char_length do banco: emoji conta 1.
    expect(faltamParaOContexto("🚗".repeat(19))).toBe(1);
  });
});

describe("o campo, na loja", () => {
  it("se chama Contexto do atendimento, tem exemplo e conta o que falta enquanto a pessoa digita", () => {
    render(<LeadFieldsForm lead={LEAD} pipelineId="p" />);
    const campo = screen.getByLabelText("Contexto do atendimento") as HTMLTextAreaElement;
    expect(campo.placeholder).toMatch(/^Ex\.: procura SUV/);
    expect(screen.getByTestId("contador-do-contexto").textContent).toBe("Faltam 20 letras (mínimo 20)");
    fireEvent.input(campo, { target: { value: "  quer SUV  " } });
    expect(screen.getByTestId("contador-do-contexto").textContent).toBe("Faltam 12 letras (mínimo 20)");
    fireEvent.input(campo, { target: { value: "procura SUV até 80 mil" } });
    expect(screen.getByTestId("contador-do-contexto").textContent).toBe("Contexto suficiente.");
  });

  it("lead que já tem contexto abre como suficiente", () => {
    render(<LeadFieldsForm lead={{ ...(LEAD as object), description: "quer financiar um Onix 2020" } as never} pipelineId="p" />);
    expect(screen.getByTestId("contador-do-contexto").textContent).toBe("Contexto suficiente.");
  });
});

describe("o campo, fora da loja (clínica): nada muda", () => {
  it("segue Descrição, sem exemplo e sem contador", () => {
    perfil.lojaDeCarros = false;
    render(<LeadFieldsForm lead={LEAD} pipelineId="p" />);
    const campo = screen.getByLabelText("Descrição") as HTMLTextAreaElement;
    expect(campo.placeholder).toBe("");
    expect(screen.queryByTestId("contador-do-contexto")).toBeNull();
    expect(screen.queryByLabelText("Contexto do atendimento")).toBeNull();
  });
});

function abrirDossie(faltam: Record<string, string[]> | null) {
  return render(
    <IncompletosNoCardContext.Provider value={faltam}>
      <LeadDossier open onOpenChange={() => {}} lead={LEAD} pipelineId="p" stageName="Novo" />
    </IncompletosNoCardContext.Provider>,
  );
}

/** true quando `a` aparece antes de `b` no documento. */
const antes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("o painel do card, na loja", () => {
  it("Dados do negócio vem ANTES da linha do tempo", () => {
    abrirDossie(null);
    expect(antes(screen.getByTestId("dados-do-negocio"), screen.getByTestId("linha-do-tempo"))).toBe(true);
  });

  it("Editar campos é um botão com quantos faltam (o mesmo mapa do selo do cartão)", () => {
    abrirDossie({ [(LEAD as { id: string }).id]: ["Contexto do atendimento", "Cidade / região", "Prazo para comprar"] });
    const botao = screen.getByTestId("editar-campos");
    expect(botao.tagName).toBe("BUTTON");
    expect(screen.getByTestId("campos-que-faltam").textContent).toBe("faltam 3");
    expect(botao.getAttribute("title")).toBe("Contexto do atendimento · Cidade / região · Prazo para comprar");
  });

  it("sem nada faltando (ou trava desligada): o botão fica, sem número", () => {
    abrirDossie({});
    expect(screen.getByTestId("editar-campos")).toBeTruthy();
    expect(screen.queryByTestId("campos-que-faltam")).toBeNull();
    cleanup();
    abrirDossie(null);
    expect(screen.queryByTestId("campos-que-faltam")).toBeNull();
  });
});

describe("o painel do card, fora da loja: como era", () => {
  it("Dados do negócio depois da linha do tempo, e o link discreto sem número", () => {
    perfil.lojaDeCarros = false;
    abrirDossie({ [(LEAD as { id: string }).id]: ["Contexto do atendimento"] });
    expect(antes(screen.getByTestId("linha-do-tempo"), screen.getByTestId("dados-do-negocio"))).toBe(true);
    expect(screen.queryByTestId("editar-campos")).toBeNull();
    expect(screen.queryByTestId("campos-que-faltam")).toBeNull();
    expect(screen.getByText("Editar campos").tagName).toBe("BUTTON");
  });
});
