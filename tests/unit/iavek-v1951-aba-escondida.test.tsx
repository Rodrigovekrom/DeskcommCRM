/**
 * ia.vek v1.9.51 (Maestro 011542): com a aba ESCONDIDA, o tempo real só MARCA o quadro como velho; ao VOLTAR a aba,
 * ele recarrega UMA vez, e a tela sabe que está atualizando. O que AVISA a pessoa (som, contador, notificação, o sino)
 * não passa pelo quadro e não olha a aba: segue na hora. (O app não tem contador no título da aba.)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
const canais = vi.hoisted(() => ({} as Record<string, (p: unknown) => void>));
vi.mock("@/lib/api/client", () => ({ apiClient: { get } }));
vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (o: { name: string; onChange?: (p: unknown) => void }) => {
    if (o.onChange) canais[o.name] = o.onChange;
    return { status: "SUBSCRIBED", ultimaEntrega: null };
  },
}));
vi.mock("@/hooks/realtime/useRefetchDeSeguranca", () => ({ useRefetchDeSeguranca: () => undefined }));
vi.mock("@/lib/iavek/vez-do-quadro", () => ({ liberarDepoisDoQuadro: () => {} }));

import { useBoard } from "@/hooks/kanban/useBoard";

const QUADRO = { pipeline: { id: "p1", organization_id: "o1", settings: null }, stages: [], leads: [] };
let visivel: "visible" | "hidden" = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visivel });
const mudarAba = (v: "visible" | "hidden") => {
  visivel = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useBoard("p1"), { wrapper });
}
const eventoDoQuadro = () => Object.entries(canais).find(([n]) => n.startsWith("kanban-") && !n.includes("conversas"))?.[1];

afterEach(() => {
  visivel = "visible";
  get.mockReset();
});

describe("aba escondida: o tempo real não vai ao banco; ao voltar, 1 recarga", () => {
  it("aba VISÍVEL: o evento recarrega na hora (como antes)", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar();
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    await act(async () => eventoDoQuadro()?.({ new: { id: "l1" } }));
    await waitFor(() => expect(get.mock.calls.length).toBe(antes + 1));
  });

  it("aba ESCONDIDA: 3 eventos, 0 idas ao banco; ao VOLTAR, EXATAMENTE 1, com o 'atualizando' até o dado chegar", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar();
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    act(() => mudarAba("hidden"));
    await act(async () => {
      eventoDoQuadro()?.({ new: { id: "l1" } });
      eventoDoQuadro()?.({ new: { id: "l2" } });
      eventoDoQuadro()?.({ new: { id: "l3" } });
    });
    await new Promise((ok) => setTimeout(ok, 30));
    expect(get.mock.calls.length).toBe(antes);
    let soltar!: (v: unknown) => void;
    get.mockImplementationOnce(() => new Promise((ok) => (soltar = ok)));
    act(() => mudarAba("visible"));
    await waitFor(() => expect(r.result.current.atualizandoAoVoltar).toBe(true));
    expect(get.mock.calls.length).toBe(antes + 1);
    await act(async () => soltar({ data: QUADRO }));
    await waitFor(() => expect(r.result.current.atualizandoAoVoltar).toBe(false));
    expect(get.mock.calls.length).toBe(antes + 1);
  });

  it("(Lupa 012629) banco lento: a recarga demora 20 s; o clique volta aos 8 s, com o 'ainda atualizando'", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar();
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    act(() => mudarAba("hidden"));
    await act(async () => eventoDoQuadro()?.({ new: { id: "l1" } }));
    let soltar!: (v: unknown) => void;
    get.mockImplementationOnce(() => new Promise((ok) => (soltar = ok)));
    const t0 = Date.now();
    act(() => mudarAba("visible"));
    await waitFor(() => expect(r.result.current.atualizandoAoVoltar).toBe(true));
    await waitFor(() => expect(r.result.current.atualizandoAoVoltar).toBe(false), { timeout: 9_500 });
    const passou = Date.now() - t0;
    expect(passou).toBeGreaterThanOrEqual(7_900);
    expect(passou).toBeLessThan(9_500);
    expect(r.result.current.aindaAtualizando).toBe(true);
    await act(async () => soltar({ data: QUADRO }));
    await waitFor(() => expect(r.result.current.aindaAtualizando).toBe(false));
  }, 15_000);

  it("voltar à aba SEM evento no meio não recarrega nada", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar();
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    act(() => mudarAba("hidden"));
    act(() => mudarAba("visible"));
    await new Promise((ok) => setTimeout(ok, 30));
    expect(get.mock.calls.length).toBe(antes);
    expect(r.result.current.atualizandoAoVoltar).toBe(false);
  });
});

describe("o que AVISA a pessoa segue na hora com a aba escondida (não passa pelo quadro nem olha a aba)", () => {
  const AVISOS = [
    "hooks/notifications/useNotify.ts",
    "hooks/notifications/useSonsDaCentral.ts",
    "components/shell/AlertsBell.tsx",
    "hooks/ai/useAgentInbox.ts",
  ];
  for (const f of AVISOS) {
    it(f, () => {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/visibilityState|document\.hidden/);
      expect(s).not.toMatch(/useBoard\b/);
    });
  }
});

describe("o sino e o som com a aba ESCONDIDA (Maestro 013808): a Central segue buscando de 30 em 30 s", () => {
  it("o useAgentInbox liga o refetchIntervalInBackground SÓ na lista aberta (a do sino)", () => {
    const s = readFileSync("hooks/ai/useAgentInbox.ts", "utf8");
    expect(s).toContain("refetchInterval: 30_000,");
    expect(s).toContain('refetchIntervalInBackground: status === "open",');
  });
});
