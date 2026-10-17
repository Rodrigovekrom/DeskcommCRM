/**
 * ia.vek v1.5 (parte B): a ficha do lead — campo do catálogo, campos da compra
 * de veículo, seções recolhíveis e o acompanhamento do funil.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ptBR } from "date-fns/locale";

vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "eu" } }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => ptBR }));
const painel = vi.hoisted(() => ({
  data: { proximo_passo: null as null | { id: string; title: string; due_date: string | null } },
}));
vi.mock("@/hooks/iavek/usePainelIavek", () => ({ usePainelIavek: () => painel }));

import { customFieldSchema } from "@/lib/schemas/settings";
import { CAMPOS_DA_COMPRA_DE_VEICULO, comCamposDaCompra } from "@/lib/iavek/campos-da-compra";
import { filtrarCatalogo } from "@/components/contacts/CampoDoCatalogo";
import { SecaoRecolhivel } from "@/components/inbox/SecaoRecolhivel";
import { AcompanhamentoDoLead } from "@/components/inbox/AcompanhamentoDoLead";

beforeEach(() => {
  window.localStorage.clear();
  painel.data.proximo_passo = null;
});

describe("campo do catálogo", () => {
  it("o schema do funil aceita o tipo catalog_product", () => {
    expect(
      customFieldSchema.safeParse({
        key: "carro_interesse",
        label: "Carro",
        type: "catalog_product",
      }).success,
    ).toBe(true);
  });

  it("a busca acha por modelo, marca ou código, sem acento, e só os ativos", () => {
    const produtos = [
      {
        id: "1",
        codigo: "ALT-10",
        nome: "Onix LT 1.0",
        marca: "Chevrolet",
        preco_cents: 1,
        moeda: "BRL",
        ativo: true,
      },
      {
        id: "2",
        codigo: "ALT-11",
        nome: "Hilux SRV",
        marca: "Toyota",
        preco_cents: 1,
        moeda: "BRL",
        ativo: true,
      },
      {
        id: "3",
        codigo: "ALT-12",
        nome: "Onix Plus",
        marca: "Chevrolet",
        preco_cents: 1,
        moeda: "BRL",
        ativo: false,
      },
    ];
    expect(filtrarCatalogo(produtos, "onix").map((p) => p.id)).toEqual(["1"]);
    expect(filtrarCatalogo(produtos, "toyota hilux").map((p) => p.id)).toEqual(["2"]);
    expect(filtrarCatalogo(produtos, "alt-11").map((p) => p.id)).toEqual(["2"]);
    expect(filtrarCatalogo(produtos, "CHEVRÔLET").map((p) => p.id)).toEqual(["1"]);
  });
});

describe("campos da compra de veículo", () => {
  it("todos passam no schema do funil", () => {
    for (const f of CAMPOS_DA_COMPRA_DE_VEICULO)
      expect(customFieldSchema.safeParse(f).success).toBe(true);
  });

  it("acrescenta só o que falta, sem sobrescrever o que o funil já tem", () => {
    const meu = { key: "cidade", label: "Minha cidade", type: "text" as const };
    const r = comCamposDaCompra([meu]);
    expect(r.filter((f) => f.key === "cidade")).toEqual([meu]);
    expect(r.map((f) => f.key)).toContain("carro_interesse");
    expect(r).toHaveLength(CAMPOS_DA_COMPRA_DE_VEICULO.length);
    expect(comCamposDaCompra(r)).toHaveLength(r.length);
  });
});

describe("seção recolhível", () => {
  it("recolhe, esconde o conteúdo e lembra por usuário", () => {
    const { unmount } = render(
      <SecaoRecolhivel id="teste" titulo="Acompanhamento">
        <p>conteúdo</p>
      </SecaoRecolhivel>,
    );
    expect(screen.getByText("conteúdo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Acompanhamento/ }));
    expect(screen.queryByText("conteúdo")).toBeNull();
    unmount();
    render(
      <SecaoRecolhivel id="teste" titulo="Acompanhamento">
        <p>conteúdo</p>
      </SecaoRecolhivel>,
    );
    expect(screen.queryByText("conteúdo")).toBeNull();
  });
});

describe("acompanhamento do funil", () => {
  const base = {
    id: "l1",
    title: "Onix",
    created_at: "2026-10-10T12:00:00.000Z",
    funil_nome: "Fenômenos — 72h",
    etapa_nome: "Qualificação",
    owner_kind: "user",
    owner_name: "Vendedor A",
  };

  it("aberto: entrou → etapa de agora, com dono e sem próximo passo", () => {
    render(
      <AcompanhamentoDoLead
        lead={{ ...base, status: "open" }}
        conversa={{ assignee_kind: "ai" }}
        contactId="c1"
      />,
    );
    const linha = screen.getByTestId("acompanhamento-linha").textContent;
    expect(linha).toContain("Entrou em 10/10/26");
    expect(linha).toContain("Agora em Qualificação");
    expect(screen.getByText("IA atendendo")).toBeTruthy();
    expect(screen.getByText("Vendedor A")).toBeTruthy();
    expect(screen.getByTestId("acompanhamento-proximo-passo").textContent).toBe("Nenhum marcado");
  });

  it("perdido: não comprou, com o motivo", () => {
    render(
      <AcompanhamentoDoLead
        lead={{
          ...base,
          status: "lost",
          closed_at: "2026-10-15T12:00:00.000Z",
          lost_reason: "Preço",
        }}
        conversa={{ assignee_kind: "user", assigned_to_user_name: "Vendedor A" }}
        contactId="c1"
      />,
    );
    expect(screen.getByTestId("acompanhamento-linha").textContent).toContain(
      "Não comprou em 15/10/26 · Preço",
    );
  });

  it("ganho: comprou; e mostra o próximo passo marcado", () => {
    painel.data.proximo_passo = { id: "t", title: "Entregar o carro", due_date: null };
    render(
      <AcompanhamentoDoLead
        lead={{ ...base, status: "won", closed_at: "2026-10-16T12:00:00.000Z" }}
        conversa={{ assignee_kind: "user", assigned_to_user_name: "Vendedor A" }}
        contactId="c1"
      />,
    );
    expect(screen.getByTestId("acompanhamento-linha").textContent).toContain("Comprou em 16/10/26");
    expect(screen.getByTestId("acompanhamento-proximo-passo").textContent).toBe("Entregar o carro");
  });
});
