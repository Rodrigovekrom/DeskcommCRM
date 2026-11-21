/**
 * ia.vek v1.9.62 (CRM-497, D4 1A/2A): o passo "Antes de passar: as tarefas deste lead" na tela. Com tarefa aberta, o
 * lead NÃO está pronto para passar (o botão de passar fica desligado); "Já fiz" e "Excluir" chamam a rota das tarefas
 * com a ação certa; sem nenhuma aberta, está pronto. A excluída aparece para "Voltar".
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const LEAD = "44444444-4444-4444-8444-444444444444";
let resposta: { abertas: unknown[]; excluidas: unknown[] };
const posts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: resposta })),
    post: vi.fn(async (_url: string, corpo: Record<string, unknown>) => {
      posts.push(corpo);
      return { data: {} };
    }),
  },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { TarefasAntesDePassar } from "@/components/iavek/TarefasAntesDePassar";

const montar = (aoMudarPronto: (p: boolean) => void) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TarefasAntesDePassar leadId={LEAD} aoMudarPronto={aoMudarPronto} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  posts.length = 0;
});

describe("o passo das tarefas antes de passar", () => {
  it("com tarefa aberta: não está pronto; 'Já fiz' e 'Excluir' mandam a ação certa para a tarefa certa", async () => {
    resposta = { abertas: [{ id: "t1", title: "Retornar ao cliente", assigned_to: null, due_date: null, status: "pending" }], excluidas: [] };
    const pronto = vi.fn();
    montar(pronto);
    await screen.findByText("Retornar ao cliente");
    expect(pronto).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByTestId("tarefa-ja-fiz"));
    await waitFor(() => expect(posts).toContainEqual({ lead_id: LEAD, task_id: "t1", acao: "feita" }));
    fireEvent.click(screen.getByTestId("tarefa-excluir"));
    await waitFor(() => expect(posts).toContainEqual({ lead_id: LEAD, task_id: "t1", acao: "excluir" }));
  });

  it("sem nenhuma aberta: pronto, e a mensagem do lead limpo", async () => {
    resposta = { abertas: [], excluidas: [] };
    const pronto = vi.fn();
    montar(pronto);
    await screen.findByTestId("tarefas-antes-de-passar-zero");
    await waitFor(() => expect(pronto).toHaveBeenLastCalledWith(true));
  });

  it("a excluída neste passo aparece para 'Voltar'", async () => {
    resposta = { abertas: [], excluidas: [{ id: "t2", title: "Ligar amanhã", assigned_to: null, due_date: null, status: "cancelled" }] };
    montar(() => undefined);
    await screen.findByText("Ligar amanhã");
    fireEvent.click(screen.getByTestId("tarefa-voltar"));
    await waitFor(() => expect(posts).toContainEqual({ lead_id: LEAD, task_id: "t2", acao: "voltar" }));
  });
});
