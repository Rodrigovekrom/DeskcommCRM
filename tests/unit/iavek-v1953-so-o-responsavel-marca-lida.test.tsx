/**
 * ia.vek v1.9.53 (Rodrigo 13/11, Maestro 131135): SÓ O RESPONSÁVEL marca a conversa como lida.
 *
 * O defeito: o admin geral abria uma conversa com 3 mensagens do cliente sem ler e o contador sumia: o
 * `mark-read` zerava `unread_count_for_assignee` de QUALQUER ator com papel agent ou acima. O vendedor
 * perdia a marcação. A regra é por PAPEL na conversa, não por pessoa:
 *  - o responsável (`assigned_to_user_id` = quem abre) zera;
 *  - admin, gestor, guardião, outro vendedor: só visualizam, NADA é gravado;
 *  - conversa sem responsável: ninguém zera ao abrir.
 * A trava está no SERVIDOR (o banco de mentira abaixo aplica os filtros do UPDATE como o PostgREST) e no
 * FRONT (o hook nem pede). E a marca "nova mensagem desde" do cartão (esperandoDesde) não depende do
 * contador: segue depois de o admin abrir.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markConversationReadHandler } from "@/app/api/v1/conversations/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { esperandoDesde } from "@/lib/iavek/ordem-do-quadro";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const CONVERSA = "00000000-0000-4000-8000-0000000000c1";
const VENDEDOR = "00000000-0000-4000-8000-0000000000b1";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const OUTRO_VENDEDOR = "00000000-0000-4000-8000-0000000000b2";

type Linha = { id: string; organization_id: string; assigned_to_user_id: string | null; unread_count_for_assignee: number };

/** O banco de mentira: uma tabela `conversations`, filtros `eq` aplicados como o PostgREST, e o log das escritas. */
function banco(linha: Linha) {
  const escritas: Array<{ filtros: Record<string, unknown>; valores: Record<string, unknown> }> = [];
  const supabase = {
    from(tabela: string) {
      expect(tabela).toBe("conversations");
      const filtros: Record<string, unknown> = {};
      let valores: Record<string, unknown> | null = null;
      const casa = () => Object.entries(filtros).every(([k, v]) => (linha as Record<string, unknown>)[k] === v);
      const q = {
        update(v: Record<string, unknown>) {
          valores = v;
          return q;
        },
        select() {
          return q;
        },
        eq(col: string, v: unknown) {
          filtros[col] = v;
          return q;
        },
        async maybeSingle() {
          if (!casa()) return { data: null, error: null };
          if (valores) {
            escritas.push({ filtros: { ...filtros }, valores });
            Object.assign(linha, valores);
          }
          return { data: { ...linha }, error: null };
        },
      };
      return q;
    },
  };
  return { supabase: supabase as never, escritas, linha };
}

const ctx = (userId: string): HandlerCtx =>
  ({ organization_id: ORG, actor: { type: "user", id: userId }, requestId: "req-1" }) as HandlerCtx;

describe("servidor: markConversationReadHandler só zera para o RESPONSÁVEL", () => {
  it("o ADMIN abre: o contador continua 3 e NADA é gravado", async () => {
    const b = banco({ id: CONVERSA, organization_id: ORG, assigned_to_user_id: VENDEDOR, unread_count_for_assignee: 3 });
    const r = await markConversationReadHandler(b.supabase, ctx(ADMIN), CONVERSA);
    expect(r.marcada).toBe(false);
    expect(r.motivo).toBe("nao_e_o_responsavel");
    expect(r.conversation.unread_count_for_assignee).toBe(3);
    expect(b.linha.unread_count_for_assignee).toBe(3);
    expect(b.escritas).toHaveLength(0);
  });

  it("OUTRO vendedor (ou o guardião) abre: também só visualiza", async () => {
    const b = banco({ id: CONVERSA, organization_id: ORG, assigned_to_user_id: VENDEDOR, unread_count_for_assignee: 3 });
    const r = await markConversationReadHandler(b.supabase, ctx(OUTRO_VENDEDOR), CONVERSA);
    expect(r.marcada).toBe(false);
    expect(b.linha.unread_count_for_assignee).toBe(3);
    expect(b.escritas).toHaveLength(0);
  });

  it("o RESPONSÁVEL abre: zera (e o UPDATE leva o filtro do responsável)", async () => {
    const b = banco({ id: CONVERSA, organization_id: ORG, assigned_to_user_id: VENDEDOR, unread_count_for_assignee: 3 });
    const r = await markConversationReadHandler(b.supabase, ctx(VENDEDOR), CONVERSA);
    expect(r.marcada).toBe(true);
    expect(b.linha.unread_count_for_assignee).toBe(0);
    expect(b.escritas).toHaveLength(1);
    expect(b.escritas[0]?.filtros).toMatchObject({ id: CONVERSA, organization_id: ORG, assigned_to_user_id: VENDEDOR });
  });

  it("SEM responsável: ninguém zera ao abrir, nem o admin", async () => {
    const b = banco({ id: CONVERSA, organization_id: ORG, assigned_to_user_id: null, unread_count_for_assignee: 2 });
    const r = await markConversationReadHandler(b.supabase, ctx(ADMIN), CONVERSA);
    expect(r.marcada).toBe(false);
    expect(r.motivo).toBe("sem_responsavel");
    expect(b.linha.unread_count_for_assignee).toBe(2);
    expect(b.escritas).toHaveLength(0);
  });

  it("conversa de outra org (ou invisível pela RLS): 404, nada gravado", async () => {
    const b = banco({ id: CONVERSA, organization_id: "outra-org", assigned_to_user_id: VENDEDOR, unread_count_for_assignee: 3 });
    await expect(markConversationReadHandler(b.supabase, ctx(VENDEDOR), CONVERSA)).rejects.toMatchObject({ status: 404 });
    expect(b.escritas).toHaveLength(0);
  });
});

const post = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {} })));
const quem = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: quem.id, support: null } }) }));

import { useMarkAsRead } from "@/hooks/inbox/useMarkAsRead";

describe("front: useMarkAsRead só PEDE quando quem olha é o responsável", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    post.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const abrir = async (userId: string, responsavel: string | null, unread = 3) => {
    quem.id = userId;
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useMarkAsRead(CONVERSA, unread, responsavel), { wrapper });
    await vi.advanceTimersByTimeAsync(2_000);
  };

  it("o admin abre a conversa do vendedor: nenhum POST mark-read", async () => {
    await abrir(ADMIN, VENDEDOR);
    expect(post).not.toHaveBeenCalled();
  });

  it("conversa sem responsável: nenhum POST", async () => {
    await abrir(ADMIN, null);
    expect(post).not.toHaveBeenCalled();
  });

  it("o responsável abre: 1 POST mark-read depois de 1,5 s", async () => {
    await abrir(VENDEDOR, VENDEDOR);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`/api/v1/conversations/${CONVERSA}/mark-read`, {});
  });
});

describe("o 'em atraso' do cartão não depende do contador", () => {
  it("o admin abriu (o contador seguiu 3, nada respondeu): a marca 'nova mensagem desde' continua", () => {
    const lead = {
      status: "open",
      conversa: {
        id: CONVERSA,
        preview: null,
        last_message_at: "2026-11-13T12:00:00Z",
        unread: 3,
        last_inbound_at: "2026-11-13T12:00:00Z",
        ultima_resposta_humana_em: "2026-11-13T10:00:00Z",
        ultima_resposta_em: "2026-11-13T10:00:00Z",
      },
    } as Parameters<typeof esperandoDesde>[0];
    expect(esperandoDesde(lead, "Em atendimento")).toBe(Date.parse("2026-11-13T12:00:00Z"));
  });
});
