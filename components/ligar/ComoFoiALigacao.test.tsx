/**
 * ia.vek CRM-532 — o "Não liguei" (pedido do Rodrigo, Maestro 211323; desenho OK da Lupa 211412).
 *
 * Trava:
 *   - a pergunta abre na VOLTA do discador, e a marca do toque já saiu ANTES de perguntar (fechar a aba depois não
 *     deixa marca para trás);
 *   - "Não liguei" fecha sem NENHUMA chamada ao servidor além do GET que abriu a pergunta (não grava nada);
 *   - o "Registrar ligação" da tela de Tarefas NÃO tem o botão.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { RegistroDeLigacao } from "@/app/app/tasks/_components/RegistroDeLigacao";
import { ApagaMarcaAntiga, ComoFoiALigacao } from "@/components/ligar/ComoFoiALigacao";
import { lerMarca, marcarLigacao } from "@/lib/ligar/marca";

const fetchEspiao = vi.fn();

beforeEach(() => {
  fetchEspiao.mockReset();
  fetchEspiao.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init || !init.method || init.method === "GET") {
      return new Response(JSON.stringify({ data: { pergunta: true, lead_id: "l-1", tarefa: null } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { registrada: true } }), { status: 201 });
  });
  vi.stubGlobal("fetch", fetchEspiao);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("CRM-532: 'Não liguei'", () => {
  it("na volta do discador: a marca sai ANTES de perguntar; 'Não liguei' fecha sem gravar nada", async () => {
    const agora = Date.now();
    marcarLigacao({ contatoId: "c-1", leadId: "l-1", tarefaId: null }, agora - 10_000); // tocou em Ligar há 10 s
    render(<ComoFoiALigacao />);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(screen.getByTestId("nao-liguei")).toBeTruthy());
    // a marca já saiu: fechar a aba agora não deixa nada para trás
    expect(lerMarca()).toBeNull();
    const chamadasAntes = fetchEspiao.mock.calls.length; // só o GET que abriu a pergunta
    fireEvent.click(screen.getByTestId("nao-liguei"));
    await waitFor(() => expect(screen.queryByTestId("nao-liguei")).toBeNull());
    expect(fetchEspiao.mock.calls.length).toBe(chamadasAntes);
    expect(fetchEspiao.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("(Lupa 211601) o Ligar num negócio COM ligação aberta (a rota acha a tarefa): o 'Não liguei' aparece também", async () => {
    fetchEspiao.mockImplementation(async (_url: string, init?: RequestInit) =>
      !init || !init.method || init.method === "GET"
        ? new Response(JSON.stringify({ data: { pergunta: true, lead_id: "l-1", tarefa: { id: "t-9", titulo: "Ligar (L2) — Maria" } } }), { status: 200 })
        : new Response("{}", { status: 201 }),
    );
    marcarLigacao({ contatoId: "c-1", leadId: "l-1", tarefaId: null }, Date.now() - 10_000);
    render(<ComoFoiALigacao />);
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(screen.getByTestId("nao-liguei")).toBeTruthy());
    expect(screen.getByText("Ligar (L2) — Maria")).toBeTruthy(); // a tarefa achada vira o subtítulo
    fireEvent.click(screen.getByTestId("nao-liguei"));
    await waitFor(() => expect(screen.queryByTestId("nao-liguei")).toBeNull());
    expect(fetchEspiao.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("(Rodrigo 17/11) quem não liga pelo CRM: a marca antiga do aparelho é APAGADA, sem perguntar e sem chamar o servidor", () => {
    marcarLigacao({ contatoId: "c-1", leadId: "l-1", tarefaId: null }, Date.now() - 10_000);
    render(<ApagaMarcaAntiga />);
    expect(lerMarca()).toBeNull();
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("o 'Registrar ligação' da tela de Tarefas NÃO tem o 'Não liguei'", () => {
    const tarefa = {
      id: "t-1", organization_id: "o", title: "Ligar (L1) — Maria", description: null, due_date: null, priority: "high",
      status: "pending", lead_id: "l-1", contact_id: "c-1", assigned_to: null, created_by: null,
      created_at: "2026-11-17T00:00:00Z", updated_at: "2026-11-17T00:00:00Z", source_kind: "ligacao:L1",
    } as never;
    render(<RegistroDeLigacao tarefa={tarefa} aoFechar={() => undefined} aoRegistrar={() => undefined} />);
    expect(screen.getByTestId("registro-de-ligacao")).toBeTruthy();
    expect(screen.queryByTestId("nao-liguei")).toBeNull();
  });
});
