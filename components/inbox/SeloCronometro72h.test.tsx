/**
 * ia.vek CRM-536 (decisão 3A): no painel das 72h, o relógio é o "Manter por mais 72h" para quem pode manter. Ele
 * pergunta antes e chama a MESMA rota do antigo botão. Sem `clicavel` (a Entrada) ou sem `pode_manter`, é só
 * leitura, como sempre foi.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const painel = vi.hoisted(() => ({ data: null as unknown }));
const post = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/iavek/usePainelIavek", () => ({
  usePainelIavek: () => ({ data: painel.data }),
  chaveDoPainelIavek: (id: string) => ["painel-iavek", id],
}));
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { SeloCronometro72h } from "@/components/inbox/SeloCronometro72h";

const fimEm = () => new Date(Date.now() + 10 * 3_600_000).toISOString();
function dados(podeManter: boolean) {
  return {
    cronometro: { fim_em: fimEm(), horas: 72, inicio: new Date().toISOString() },
    pode_manter: podeManter,
    lead: { id: "lead-1" },
  };
}
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  qc = new QueryClient();
  post.mockReset();
  post.mockResolvedValue({ data: { lead_id: "lead-1" } });
});

describe("CRM-536: o relógio das 72h é o 'Manter'", () => {
  it("no painel, para quem pode manter: é um botão, pergunta antes e só então chama /esteira/manter", async () => {
    painel.data = dados(true);
    render(<SeloCronometro72h contactId="c-1" clicavel />, { wrapper });
    const selo = screen.getByTestId("selo-cronometro-72h");
    expect(selo.tagName).toBe("BUTTON");
    fireEvent.click(selo);
    expect(post).not.toHaveBeenCalled(); // tocar só abre a pergunta
    expect(screen.getByText("Manter por mais 72h?")).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirmar-manter"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/iavek/esteira/manter", { lead_id: "lead-1" }),
    );
  });

  it("no painel, para quem NÃO pode manter: só leitura (nada a tocar)", () => {
    painel.data = dados(false);
    render(<SeloCronometro72h contactId="c-1" clicavel />, { wrapper });
    expect(screen.getByTestId("selo-cronometro-72h").tagName).toBe("SPAN");
  });

  it("fora do painel (a Entrada, sem `clicavel`): só leitura, mesmo para quem pode manter", () => {
    painel.data = dados(true);
    render(<SeloCronometro72h contactId="c-1" />, { wrapper });
    expect(screen.getByTestId("selo-cronometro-72h").tagName).toBe("SPAN");
  });

  it("sem o cronômetro (o lead fora das 72h), nada aparece", () => {
    painel.data = { cronometro: null, pode_manter: true, lead: { id: "lead-1" } };
    const { container } = render(<SeloCronometro72h contactId="c-1" clicavel />, { wrapper });
    expect(container.innerHTML).toBe("");
  });
});
