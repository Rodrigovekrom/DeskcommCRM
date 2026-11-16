/**
 * ia.vek v1.9.52.5 (CRM-410, Rodrigo 15/11): o Meu dia do SDR de Follow-up.
 *
 * Antes, o servidor só dava o dia PESSOAL a sdr/suporte/vendedor; o sdr_followup caía no ramo do GERENTE
 * (contagens da loja) e ficava sem a lista "Ligações do dia". Agora:
 *  - temDiaPessoal: sdr, suporte, vendedor e sdr_followup (e NÃO o gerente/apoio/analista);
 *  - temFilaDoSdr: a fila das 72h e a meta ficam só com o SDR de entrada e o Suporte IA;
 *  - a rota usa as duas funções (não uma lista própria que volte a esquecer a função nova);
 *  - a tela, com a resposta pessoal, mostra as ligações do SDR de Follow-up.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  org: { orgId: "o", role: "agent", interface_settings: { preset: "completa", funcao: "sdr_followup" } } as Record<string, unknown>,
  resposta: {} as unknown,
  get: vi.fn(),
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useFuncaoVistaOpcional: () => null,
  useAuth: () => ({ activeOrg: mocks.org, user: { id: "eu" } }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: (url: string) => {
      mocks.get(url);
      if (url.startsWith("/api/v1/iavek/pedidos-de-agendamento")) {
        return Promise.resolve({ data: { pedidos: [], pode_decidir: false } });
      }
      if (url.startsWith("/api/v1/agenda/tipos")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: mocks.resposta });
    },
    patch: vi.fn(),
  },
}));

import { FUNCOES, temDiaPessoal, temFilaDoSdr } from "@/lib/iavek/funcoes";
import { MeuDia } from "@/components/iavek/MeuDia";

describe("v1.9.52.5 — quem tem o dia pessoal", () => {
  it("o SDR de Follow-up tem o dia pessoal; gerente, apoio e analista não", () => {
    const pessoais = FUNCOES.filter((f) => temDiaPessoal(f));
    expect(pessoais.sort()).toEqual(["sdr", "sdr_followup", "suporte", "vendedor"]);
  });
  it("a fila das 72h e a meta ficam só com o SDR de entrada e o Suporte IA (não com o de Follow-up)", () => {
    expect(FUNCOES.filter((f) => temFilaDoSdr(f)).sort()).toEqual(["sdr", "suporte"]);
    expect(temFilaDoSdr("sdr_followup")).toBe(false);
  });
  it("a rota do Meu dia decide pelas duas funções (sem lista própria de funções)", () => {
    const rota = readFileSync("app/api/v1/iavek/meu-dia/route.ts", "utf8");
    expect(rota).toContain("if (temDiaPessoal(funcao)) {");
    expect(rota).toContain("const ehSdr = temFilaDoSdr(funcao);");
    expect(rota).not.toMatch(/funcao === "sdr" \|\| funcao === "suporte" \|\| funcao === "vendedor"/);
  });
});

describe("v1.9.52.5 — a tela do SDR de Follow-up", () => {
  it("mostra as ligações do dia dele e não o painel do gerente", async () => {
    mocks.resposta = {
      funcao: "sdr_followup",
      pessoal: {
        agendamentos: [],
        leads: [],
        proximos_passos: [],
        propostas: [],
        ligacoes: [
          { id: "t1", title: "Ligar (L4) — Bia", due_date: "2026-11-16T15:00:00Z", status: "pending",
            source_kind: "ligacao:L4", contact_id: "c1", lead_id: "l1", contato_nome: "Bia", conversation_id: null },
        ],
      },
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MeuDia />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    expect(await screen.findByText("Ligações do dia")).toBeTruthy();
    expect(screen.getByText(/Ligar \(L4\)/)).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/iavek/meu-dia?funcao=sdr_followup");
    expect(screen.queryByText("Leads novos (72h)")).toBeNull();
    expect(screen.queryByText("Atrasos por pessoa")).toBeNull();
  });
});
