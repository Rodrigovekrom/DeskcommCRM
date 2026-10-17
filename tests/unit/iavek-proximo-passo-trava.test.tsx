/**
 * ia.vek v1.5: a TRAVA do próximo passo. Fechar/arquivar só segue depois de o
 * humano dono marcar "o quê + quando" (que vira crm_task com
 * source_kind='proximo_passo'); cancelar não deixa seguir; com o próximo passo
 * já marcado, ou com a IA atendendo, nada é pedido.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  painel: {
    lead: { id: "lead-1", title: "x", pipeline_id: "p" },
    cronometro: null,
    proximo_passo: null,
  } as {
    lead: { id: string; title: string; pipeline_id: string } | null;
    cronometro: null;
    proximo_passo: { id: string; title: string; due_date: string | null } | null;
  },
  post: vi.fn(async (_path: string, _body: unknown) => ({ data: { task: { id: "t1" } } })),
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "eu" } }) }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: mocks.painel })),
    post: mocks.post,
  },
}));

import { useProximoPassoObrigatorio } from "@/components/inbox/ProximoPassoObrigatorio";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

const conversa = {
  id: "conv-1",
  contact_id: "contato-1",
  assignee_kind: "user",
  assigned_to_user_id: "eu",
  is_group: false,
  contacts: { name: "Cliente" },
} as unknown as ConversationWithContact;

let api: ReturnType<typeof useProximoPassoObrigatorio>;
function Sonda() {
  api = useProximoPassoObrigatorio();
  return <>{api.dialogo}</>;
}
function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  render(<Sonda />, { wrapper });
}

beforeEach(() => {
  mocks.post.mockClear();
  mocks.painel.proximo_passo = null;
});

describe("próximo passo obrigatório: a trava", () => {
  it("sem próximo passo, fechar só segue depois de salvar o quê + quando", async () => {
    montar();
    let resultado: boolean | undefined;
    act(() => {
      void api.garantir(conversa, "fechar").then((r) => (resultado = r));
    });
    const oque = await screen.findByTestId("proximo-passo-oque");
    expect(resultado).toBeUndefined();
    fireEvent.change(oque, { target: { value: "Ligar amanhã" } });
    fireEvent.click(screen.getByTestId("proximo-passo-salvar"));
    await waitFor(() => expect(resultado).toBe(true));
    const corpo = mocks.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(mocks.post.mock.calls[0]![0]).toBe("/api/v1/tasks");
    expect(corpo).toMatchObject({
      title: "Ligar amanhã",
      contact_id: "contato-1",
      lead_id: "lead-1",
      assigned_to: "eu",
      source_kind: "proximo_passo",
    });
    expect(typeof corpo.due_date).toBe("string");
  });

  it("cancelar NÃO deixa fechar", async () => {
    montar();
    let resultado: boolean | undefined;
    act(() => {
      void api.garantir(conversa, "arquivar").then((r) => (resultado = r));
    });
    await screen.findByTestId("proximo-passo-oque");
    fireEvent.click(screen.getByText("Cancelar"));
    await waitFor(() => expect(resultado).toBe(false));
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("com o próximo passo já marcado, segue direto", async () => {
    mocks.painel.proximo_passo = { id: "t0", title: "já tem", due_date: null };
    montar();
    await expect(api.garantir(conversa, "fechar")).resolves.toBe(true);
    expect(screen.queryByTestId("proximo-passo-oque")).toBeNull();
  });

  it("com a IA atendendo, nada é pedido", async () => {
    montar();
    const daIa = {
      ...conversa,
      assignee_kind: "ai",
      assigned_to_user_id: null,
    } as ConversationWithContact;
    await expect(api.garantir(daIa, "fechar")).resolves.toBe(true);
    expect(screen.queryByTestId("proximo-passo-oque")).toBeNull();
  });
});
