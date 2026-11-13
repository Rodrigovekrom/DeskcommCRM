/**
 * ia.vek v1.9.51.4 (Lupa 192902, Maestro 192916): o clique da SDR no Pipeline sem as chamadas REPETIDAS.
 * MEDIDO no canário antes (13/11): 'Assumir' = 1 escrita + 11 leituras (quadro 2x, painel 3x, selo 3x, faixa sem dono 3x).
 *  1. criarRecargaAgrupada: muitos pedidos seguidos = UMA recarga; nunca depois do teto; cancelar = nenhuma.
 *  2. useBoard (com agrupamento): a leva SÓ de ecos de ação minha NÃO recarrega o quadro; com um evento de fora, recarrega.
 *  3. invalidarQuadrosDoFunil: os quadros do funil sim; a faixa sem dono e o quadro de OUTRO funil, não.
 *  4. as fontes: o painel e o selo pelo useRecargaAgrupada; o 'Assumir' marca o eco e tira o lead da faixa na hora.
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

import { invalidarQuadrosDoFunil, useBoard } from "@/hooks/kanban/useBoard";
import { criarRecargaAgrupada } from "@/lib/iavek/recarga-agrupada";
import { liberarEcoLocal, marcarEcoLocal } from "@/lib/kanban/local-echo";

const QUADRO = { pipeline: { id: "p1", organization_id: "o1", settings: null }, stages: [], leads: [] };
const eventoDoQuadro = () => Object.entries(canais).find(([n]) => n.startsWith("kanban-") && !n.includes("conversas"))?.[1];
function montar(agruparEventosMs: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useBoard("p1", { agruparEventosMs }), { wrapper });
}
afterEach(() => {
  get.mockReset();
  vi.useRealTimers();
});

describe("1. criarRecargaAgrupada", () => {
  function relogio() {
    let t = 0;
    const fila: Array<{ em: number; fn: () => void; id: number }> = [];
    let id = 0;
    return {
      agora: () => t,
      agendar: (fn: () => void, ms: number) => {
        fila.push({ em: t + ms, fn, id: ++id });
        return id;
      },
      desagendar: (x: unknown) => {
        const i = fila.findIndex((f) => f.id === x);
        if (i >= 0) fila.splice(i, 1);
      },
      andar(ms: number) {
        const fim = t + ms;
        for (;;) {
          fila.sort((a, b) => a.em - b.em);
          const p = fila[0];
          if (!p || p.em > fim) break;
          fila.shift();
          t = p.em;
          p.fn();
        }
        t = fim;
      },
    };
  }

  it("3 pedidos em 1 s = UMA recarga, 2 s depois do último", () => {
    const r = relogio();
    const fn = vi.fn();
    const g = criarRecargaAgrupada(fn, { esperaMs: 2000, tetoMs: 4000, ...r });
    g.pedir();
    r.andar(500);
    g.pedir();
    r.andar(500);
    g.pedir();
    r.andar(1999);
    expect(fn).not.toHaveBeenCalled();
    r.andar(1);
    expect(fn).toHaveBeenCalledTimes(1);
    r.andar(10_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("pedidos sem parar: nunca passa do TETO desde o 1º (4 s), e a leva seguinte começa de novo", () => {
    const r = relogio();
    const fn = vi.fn();
    const g = criarRecargaAgrupada(fn, { esperaMs: 2000, tetoMs: 4000, ...r });
    for (let i = 0; i < 8; i++) {
      g.pedir();
      r.andar(1000);
    }
    // pedidos em 0..7 s, a cada 1 s: a 1ª leva (0-3 s) dispara aos 4 s (o teto, não esperou o silêncio); a 2ª (4-7 s), aos 8 s
    expect(fn).toHaveBeenCalledTimes(2);
    r.andar(5000);
    expect(fn).toHaveBeenCalledTimes(2); // nada pendente: nenhuma recarga a mais
    g.pedir();
    r.andar(2000);
    expect(fn).toHaveBeenCalledTimes(3); // uma leva nova, sozinha: 2 s depois
  });

  it("cancelar (a tela saiu) = nenhuma recarga", () => {
    const r = relogio();
    const fn = vi.fn();
    const g = criarRecargaAgrupada(fn, { esperaMs: 2000, tetoMs: 4000, ...r });
    g.pedir();
    g.cancelar();
    r.andar(10_000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("2. useBoard: a leva só de ecos da minha ação não recarrega o quadro", () => {
  it("o eco da MINHA ação (marca aberta): 2 eventos do mesmo lead = 0 idas ao banco", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar(30);
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    marcarEcoLocal("l-meu");
    await act(async () => {
      eventoDoQuadro()?.({ new: { id: "l-meu" } });
      eventoDoQuadro()?.({ new: { id: "l-meu" } });
    });
    await new Promise((ok) => setTimeout(ok, 80));
    expect(get.mock.calls.length).toBe(antes);
    liberarEcoLocal("l-meu");
  });

  it("contra-prova: na MESMA leva, um evento de OUTRO lead (de fora) = recarrega 1 vez", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar(30);
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    marcarEcoLocal("l-meu2");
    await act(async () => {
      eventoDoQuadro()?.({ new: { id: "l-meu2" } });
      eventoDoQuadro()?.({ new: { id: "l-de-fora" } });
    });
    await waitFor(() => expect(get.mock.calls.length).toBe(antes + 1));
    await new Promise((ok) => setTimeout(ok, 80));
    expect(get.mock.calls.length).toBe(antes + 1);
    liberarEcoLocal("l-meu2");
  });

  it("contra-prova: o evento de fora PRIMEIRO e o eco depois = recarrega", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar(30);
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    marcarEcoLocal("l-meu3");
    await act(async () => {
      eventoDoQuadro()?.({ new: { id: "l-de-fora" } });
      eventoDoQuadro()?.({ new: { id: "l-meu3" } });
    });
    await waitFor(() => expect(get.mock.calls.length).toBe(antes + 1));
    liberarEcoLocal("l-meu3");
  });

  it("evento SEM id (não dá para saber de quem é) = recarrega", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar(30);
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    await act(async () => eventoDoQuadro()?.({}));
    await waitFor(() => expect(get.mock.calls.length).toBe(antes + 1));
  });

  it("sem agrupamento (as outras telas): o eco recarrega como antes", async () => {
    get.mockResolvedValue({ data: QUADRO });
    const r = montar(0);
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true));
    const antes = get.mock.calls.length;
    marcarEcoLocal("l-meu4");
    await act(async () => eventoDoQuadro()?.({ new: { id: "l-meu4" } }));
    await waitFor(() => expect(get.mock.calls.length).toBe(antes + 1));
    liberarEcoLocal("l-meu4");
  });
});

describe("3. invalidarQuadrosDoFunil", () => {
  it("os quadros do funil (loja e carteira) ficam velhos; a faixa sem dono e o outro funil, não", async () => {
    const qc = new QueryClient();
    for (const k of [["board", "p1"], ["board", "p1", "carteira", null], ["board", "p1", "sem-dono"], ["board", "p2"]]) qc.setQueryData(k, { x: 1 });
    await invalidarQuadrosDoFunil(qc, "p1");
    const velho = (k: unknown[]) => qc.getQueryState(k)?.isInvalidated;
    expect(velho(["board", "p1"])).toBe(true);
    expect(velho(["board", "p1", "carteira", null])).toBe(true);
    expect(velho(["board", "p1", "sem-dono"])).toBe(false);
    expect(velho(["board", "p2"])).toBe(false);
  });
});

describe("4. as fontes", () => {
  const tela = readFileSync("app/app/pipeline/_client.tsx", "utf8");
  it("o painel e o selo recarregam pela leva agrupada", () => {
    expect(tela).toMatch(/const recarregar = useRecargaAgrupada\(recarregarJa\)/);
    expect(tela).toMatch(/const recarregarPadrao = useRecargaAgrupada\(/);
    expect(tela).not.toMatch(/queryKey: \["board", pipelineId\] \}\)/);
  });
  it("o 'Assumir' marca o eco e tira o lead da faixa na hora; e libera a marca no fim", () => {
    const assumir = tela.slice(tela.indexOf("apiClient.post(`/api/v1/iavek/pipeline/assumir`"));
    expect(assumir.slice(0, 900)).toMatch(/onMutate: \(leadId\) => \{\s*marcarEcoLocal\(leadId\);/);
    expect(assumir.slice(0, 900)).toMatch(/itens: atual\.itens\.filter\(\(l\) => l\.id !== leadId\)/);
    expect(assumir.slice(0, 1400)).toMatch(/onSettled: \(_d, _e, leadId\) => \{\s*liberarEcoLocal\(leadId\);/);
  });
  it("as mutações do quadro usam o invalidarQuadrosDoFunil (sem a chave-prefixo)", () => {
    for (const f of ["hooks/kanban/useUpdateLead.ts", "hooks/kanban/useMoveCard.ts", "hooks/kanban/useNextAction.ts", "hooks/kanban/useBulkAction.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toMatch(/invalidarQuadrosDoFunil\(qc, pipelineId\)/);
      expect(s, f).not.toMatch(/qc\.invalidateQueries\(\{ queryKey(: \["board", pipelineId\])? \}\)/);
    }
  });
});
