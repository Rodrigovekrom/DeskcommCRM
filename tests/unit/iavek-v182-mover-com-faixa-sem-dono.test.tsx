import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMoveCard } from "@/hooks/kanban/useMoveCard";
import type { BoardData } from "@/lib/kanban/types";

/**
 * ia.vek v1.8.2 — no Pipeline do vendedor, o cache tem o quadro da carteira
 * (`["board", id, "carteira"]`) E a faixa "Chegaram agora — sem dono"
 * (`["board", id, "sem-dono"]`, dado `{ total, itens }`). O mover atualiza por
 * PREFIXO; até a v1.8.2 o `.leads.map` lançava na faixa, o POST nunca saía e a
 * tela dizia "Erro inesperado" (medido no canário arrastando pela tela).
 */

const post = vi.hoisted(() => vi.fn());
const showApiError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError }));

const PIPELINE = "p-1";
const LEAD = "l-1";

function carteira(): BoardData {
  return {
    pipeline: { id: PIPELINE } as BoardData["pipeline"],
    stages: [],
    leads: [
      { id: LEAD, stage_id: "s-1", position_in_stage: 1000, updated_at: "2026-10-24T12:00:00.000Z" } as BoardData["leads"][number],
    ],
  };
}

let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

beforeEach(() => {
  post.mockReset();
  showApiError.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(["board", PIPELINE, "carteira"], carteira());
  qc.setQueryData(["board", PIPELINE, "sem-dono"], { total: 2, itens: [] });
});

describe("mover com a faixa 'sem dono' no cache", () => {
  it("o POST sai, o cartão anda na carteira e a faixa fica intacta", async () => {
    post.mockResolvedValueOnce({
      data: { id: LEAD, stage_id: "s-2", position_in_stage: 1500, updated_at: "2026-10-24T12:00:01.000Z" },
    });
    const { result } = renderHook(() => useMoveCard(PIPELINE), { wrapper });

    await act(() =>
      result.current.mutateAsync({
        leadId: LEAD,
        stageId: "s-2",
        positionInStage: 1500,
        expectedUpdatedAt: "2026-10-24T12:00:00.000Z",
      }),
    );

    expect(post).toHaveBeenCalledTimes(1);
    expect(showApiError).not.toHaveBeenCalled();
    const card = qc.getQueryData<BoardData>(["board", PIPELINE, "carteira"])!.leads[0]!;
    expect(card.stage_id).toBe("s-2");
    expect(qc.getQueryData(["board", PIPELINE, "sem-dono"])).toEqual({ total: 2, itens: [] });
  });
});
