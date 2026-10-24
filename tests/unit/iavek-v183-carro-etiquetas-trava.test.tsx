import { readFileSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { nomeDoCarro } from "@/components/contacts/CampoDoCatalogo";
import { sugestoesDeEtiqueta } from "@/components/iavek/SeletorDeEtiquetas";
import { ApiError } from "@/lib/api/types";
import { faltamDaTrava, recusaDeMotivoDaPerdaPeloBanco } from "@/lib/leads/motivo-da-perda";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const post = vi.hoisted(() => vi.fn());
const showApiError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError }));

/** ia.vek v1.8.3 — os 3 defeitos que o Maestro achou testando a v1.8.2 no canário. */
describe("v1.8.3 — o cartão mostra o NOME do carro, não o id", () => {
  const id = "69278c77-267c-4a0e-9a51-6f1d2b3c4d5e";
  const catalogo = [{ id, nome: "CAOA Chery Tiggo 5X" }];

  it("id do catálogo vira o nome", () => {
    expect(nomeDoCarro(id, catalogo)).toBe("CAOA Chery Tiggo 5X");
  });
  it("texto antigo (de antes da v1.5) aparece como veio", () => {
    expect(nomeDoCarro("  Onix 2020 ", catalogo)).toBe("Onix 2020");
  });
  it("sem catálogo ainda: undefined (a tela diz 'Carregando…', nunca o id)", () => {
    expect(nomeDoCarro(id, undefined)).toBeUndefined();
  });
  it("id fora do catálogo: '' (a tela diz 'Carro fora do catálogo')", () => {
    expect(nomeDoCarro("00000000-0000-4000-8000-000000000000", catalogo)).toBe("");
  });
  it("vazio: null", () => {
    expect(nomeDoCarro("", catalogo)).toBeNull();
    expect(nomeDoCarro(undefined, catalogo)).toBeNull();
  });
  it("cartão e barra lateral leem pelo mesmo hook", () => {
    expect(ler("components/iavek/CartaoIavek.tsx")).toContain("useNomeDoCarro(campos.carro_interesse)");
    expect(ler("components/iavek/ResumoNaBarra.tsx")).toContain('case "carro_interesse": return carro;');
  });
});

describe("v1.8.3 — etiquetas do lead são SELETOR", () => {
  it("sugere só as existentes que ainda não estão no lead, ignorando maiúsculas", () => {
    expect(sugestoesDeEtiqueta(["Troca", "VIP", "financiado"], ["vip"], "")).toEqual(["Troca", "financiado"]);
    expect(sugestoesDeEtiqueta(["Troca", "VIP", "financiado"], [], "fin")).toEqual(["financiado"]);
    expect(sugestoesDeEtiqueta(["Troca"], [], "nova-etiqueta")).toEqual([]);
  });
  it("os três formulários de lead usam o seletor; o texto livre saiu", () => {
    for (const f of [
      "components/kanban/LeadFieldsForm.tsx",
      "components/kanban/EditLeadDialog.tsx",
      "components/kanban/NewLeadDialog.tsx",
    ]) {
      const c = ler(f);
      expect(c, f).toContain("<SeletorDeEtiquetas");
      expect(c, f).not.toContain("Tags (separadas por vírgula)");
    }
  });
  it("a lista vem da mesma régua da recusa (fn_vocabulario_de_tags), lida por qualquer papel", () => {
    const rota = ler("app/api/v1/tags/existentes/route.ts");
    expect(rota).toContain('requireRole("viewer"');
    expect(rota).toContain('rpc("fn_vocabulario_de_tags"');
    expect(ler("lib/iavek/etiquetas.ts")).toContain('rpc("fn_vocabulario_de_tags"');
  });
  it("só o admin cria digitando", () => {
    expect(ler("components/iavek/SeletorDeEtiquetas.tsx")).toContain('useActiveOrg()?.role === "admin"');
  });
});

describe("v1.8.3 — a recusa da trava abre a janela, não um toast", () => {
  it("o servidor lê os rótulos da mensagem do banco", () => {
    expect(faltamDaTrava("Faltam campos obrigatórios: Guardião responsável, Carro de interesse")).toEqual([
      "Guardião responsável",
      "Carro de interesse",
    ]);
    expect(recusaDeMotivoDaPerdaPeloBanco({ code: "PT422", message: "Faltam campos obrigatórios: Tags de acompanhamento" })?.faltam).toEqual([
      "Tags de acompanhamento",
    ]);
  });

  it("a rota /move manda a lista em details.faltam", () => {
    expect(ler("app/api/v1/leads/[id]/move/route.ts")).toContain("details: { faltam: recusa.faltam }");
  });

  it("o hook chama onTravaDaLoja e NÃO mostra toast", async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    post.mockRejectedValueOnce(
      new ApiError(422, "iavek_campos_obrigatorios", { faltam: ["Guardião responsável"] }, "req-1", "Faltam campos obrigatórios: Guardião responsável"),
    );
    const onTravaDaLoja = vi.fn();
    const { useMoveCard } = await import("@/hooks/kanban/useMoveCard");
    const { result } = renderHook(() => useMoveCard("p-1", { onTravaDaLoja }), { wrapper });
    await act(async () => {
      await result.current
        .mutateAsync({ leadId: "l-1", stageId: "s-2", positionInStage: 1, expectedUpdatedAt: "2026-10-24T12:00:00.000Z" })
        .catch(() => undefined);
    });
    expect(onTravaDaLoja).toHaveBeenCalledWith({ leadId: "l-1", faltam: ["Guardião responsável"] });
    expect(showApiError).not.toHaveBeenCalled();
  });

  it("o quadro liga a janela e a ficha abre já nos campos", () => {
    const q = ler("components/kanban/KanbanBoard.tsx");
    expect(q).toContain("onTravaDaLoja: setTravaDaLoja");
    expect(q).toContain("<TravaDosCamposDialog");
    expect(q).toContain("focarCampos={focarCampos}");
  });
});

describe("v1.8.3 — convites valem 7 dias", () => {
  it("a validade do token e do convite é de 7 dias", async () => {
    const { INVITE_TTL_SECONDS } = await import("@/lib/auth/invite-token");
    expect(INVITE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(ler("app/team/accept-invite/[token]/page.tsx")).not.toContain("janela de 24h");
  });
});

describe("v1.8.3 — guardião na chegada (0591 no baseline)", () => {
  it("o apêndice está antes da varredura anon e o gatilho de inserção existe", () => {
    const b = ler("supabase/baseline.sql");
    const i = b.indexOf("-- ---- ia.vek: guardião na chegada (migration 0591) ----");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(b.indexOf("-- ---- VARREDURA anon:"));
    const bloco = b.slice(i, b.indexOf("-- ---- VARREDURA anon:"));
    expect(bloco).toContain("create trigger trg_iavek_guardiao_na_chegada");
    expect(bloco).toContain("revoke execute on function public.fn_iavek_guardiao_na_chegada() from public, anon, authenticated;");
  });
});
