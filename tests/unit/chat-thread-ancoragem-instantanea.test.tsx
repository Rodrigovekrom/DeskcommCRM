import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/types/messaging";

/**
 * A PRIMEIRA ANCORAGEM É INSTANTÂNEA; AS SEGUINTES, SUAVES (#1590, PR #1617).
 *
 * Ao abrir uma conversa, o fio ia ao fim com `behavior: "smooth"`: quem atende
 * via o histórico antigo passando e esperava a animação antes de ler a última
 * mensagem. A regra agora é `auto` na abertura de cada conversa — inclusive a
 * que abre VAZIA e recebe o conteúdo depois (o cartão de passagem chega após a
 * primeira pintura, ver o comentário do efeito em ChatThread.tsx) — e `smooth`
 * só para o que chega depois.
 *
 * Nenhum outro teste renderiza o ChatThread de verdade, então sem este nada
 * impediria a linha de voltar a `smooth` fixo.
 */

const estado = vi.hoisted(() => ({ mensagens: [] as unknown[], carregando: false }));

vi.mock("@/hooks/inbox/useMessagesRealtime", () => ({
  useMessagesRealtime: () => ({
    data: estado.carregando ? undefined : { pages: [{ data: estado.mensagens }] },
    isLoading: estado.carregando,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/inbox/useConversationNotes", () => ({ useConversationNotes: () => [] }));
vi.mock("@/hooks/inbox/usePassagensDaConversa", () => ({ usePassagensDaConversa: () => [] }));
vi.mock("@/hooks/inbox/useClaimConversation", () => ({
  useClaimConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/inbox/useDeleteNote", () => ({ useDeleteNote: () => ({ mutate: vi.fn() }) }));
vi.mock("@/hooks/ai/useDebugToggle", () => ({ useDebugToggle: () => ({ enabled: false }) }));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useFuncaoVistaOpcional: () => null,
  useActiveOrg: () => ({ role: "agent" }),
  useUser: () => ({ id: "u-1" }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/i18n/useLocaleDeData", () => ({ useLocaleDeData: () => undefined }));
vi.mock("@/components/inbox/MessageBubble", () => ({ MessageBubble: () => <div /> }));
vi.mock("@/components/inbox/NoteCard", () => ({ NoteCard: () => null }));
vi.mock("@/components/inbox/PassagemCard", () => ({ PassagemCard: () => null }));

import { ChatThread } from "@/components/inbox/ChatThread";

function mensagem(n: number): Message {
  return {
    id: `m-${n}`,
    sent_at: new Date(Date.UTC(2026, 8, 24, 12, n)).toISOString(),
    reply_to_message_id: null,
  } as unknown as Message;
}

// O ChatThread usa `useAlterarMensagem` (react-query) desde o #1626; o `wrapper`
// do RTL é mantido no `rerender`, e o cliente é um só por teste.
let qc: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>{children}</QueryClientProvider>
);

const rolar = vi.fn();
const original = Element.prototype.scrollIntoView;

/** O `behavior` de cada chamada, em ordem. */
function comportamentos(): unknown[] {
  return rolar.mock.calls.map((c) => (c[0] as ScrollIntoViewOptions).behavior);
}

describe("ChatThread: ancoragem ao fim", () => {
  beforeEach(() => {
    qc = new QueryClient();
    rolar.mockClear();
    estado.mensagens = [];
    estado.carregando = false;
    Element.prototype.scrollIntoView = rolar;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("abre a conversa com histórico indo ao fim SEM animação", () => {
    estado.mensagens = [mensagem(1), mensagem(2)];
    render(<ChatThread conversationId="c-1" />, { wrapper });
    expect(rolar).toHaveBeenCalledWith({ behavior: "auto", block: "end" });
    expect(comportamentos()).not.toContain("smooth");
  });

  it("mensagem nova, depois da abertura, rola suave", () => {
    estado.mensagens = [mensagem(1)];
    const { rerender } = render(<ChatThread conversationId="c-1" />, { wrapper });
    rolar.mockClear();
    estado.mensagens = [mensagem(1), mensagem(2)];
    rerender(<ChatThread conversationId="c-1" />);
    expect(comportamentos()).toEqual(["smooth"]);
  });

  it("conversa que abre vazia: o primeiro conteúdo que chega ainda é a abertura (auto)", () => {
    const { rerender } = render(<ChatThread conversationId="c-1" />, { wrapper });
    estado.mensagens = [mensagem(1)];
    rerender(<ChatThread conversationId="c-1" />);
    expect(comportamentos()).toEqual(["auto"]);
  });

  it("trocar de conversa volta a abrir instantâneo", () => {
    estado.mensagens = [mensagem(1)];
    const { rerender } = render(<ChatThread conversationId="c-1" />, { wrapper });
    rolar.mockClear();
    rerender(<ChatThread conversationId="c-2" />);
    expect(comportamentos()).toEqual(["auto"]);
  });

  it("(CRM-539) o fio observa o CONTEÚDO dentro do scroller, e o que cresce depois reancora no fim", () => {
    const observados: Element[] = [];
    const cbs: Array<() => void> = [];
    const antes = globalThis.ResizeObserver;
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        cbs.push(cb);
      }
      observe(el: Element) {
        observados.push(el);
      }
      disconnect() {}
    };
    try {
      estado.mensagens = [mensagem(1)];
      const { container } = render(<ChatThread conversationId="c-1" />, { wrapper });
      // o conteúdo do fio E o próprio scroller (que volta do display:none no celular)
      expect(observados).toHaveLength(2);
      const conteudo = observados[0] as HTMLElement;
      const sc = conteudo.parentElement as HTMLElement;
      expect(observados[1]).toBe(sc);
      expect(sc.className).toContain("overflow-y-auto");
      expect(container.contains(conteudo)).toBe(true);
      let topo = 0;
      Object.defineProperty(sc, "clientHeight", { configurable: true, get: () => 500 });
      Object.defineProperty(sc, "scrollHeight", { configurable: true, get: () => 1800 });
      Object.defineProperty(sc, "scrollTop", {
        configurable: true,
        get: () => topo,
        set: (v: number) => (topo = v),
      });
      cbs.forEach((cb) => cb());
      expect(topo).toBe(1800);
    } finally {
      (globalThis as { ResizeObserver: unknown }).ResizeObserver = antes;
    }
  });

  /** O ResizeObserver de mentira: quem foi observado, quantos foram desligados, e os callbacks para "crescer". */
  function observadorFalso() {
    const r = { observados: [] as Element[], desligados: 0, cbs: [] as Array<() => void> };
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        r.cbs.push(cb);
      }
      observe(el: Element) {
        r.observados.push(el);
      }
      disconnect() {
        r.desligados += 1;
      }
    };
    return r;
  }
  function crescer(sc: HTMLElement, altura: number, cbs: Array<() => void>) {
    let topo = 0;
    Object.defineProperty(sc, "clientHeight", { configurable: true, get: () => 500 });
    Object.defineProperty(sc, "scrollHeight", { configurable: true, get: () => altura });
    Object.defineProperty(sc, "scrollTop", {
      configurable: true,
      get: () => topo,
      set: (v: number) => (topo = v),
    });
    cbs.forEach((cb) => cb());
    return topo;
  }

  it("(Lupa 120412) a 1ª abertura FORA do cache: carregando (o Skeleton) → as mensagens chegam → o observador liga e o crescimento desce ao fim", () => {
    const antes = globalThis.ResizeObserver;
    const ro = observadorFalso();
    try {
      estado.carregando = true;
      const { rerender } = render(<ChatThread conversationId="c-1" />, { wrapper });
      expect(ro.observados).toHaveLength(0);
      estado.carregando = false;
      estado.mensagens = [mensagem(1), mensagem(2)];
      rerender(<ChatThread conversationId="c-1" />);
      expect(ro.observados).toHaveLength(2);
      const sc = ro.observados[1] as HTMLElement;
      expect(sc.className).toContain("overflow-y-auto");
      expect(crescer(sc, 1800, ro.cbs)).toBe(1800);
    } finally {
      (globalThis as { ResizeObserver: unknown }).ResizeObserver = antes;
    }
  });

  it("(Lupa 120412) trocar de conversa passando pelo Skeleton: o observador da velha desliga e o da nova liga", () => {
    const antes = globalThis.ResizeObserver;
    const ro = observadorFalso();
    try {
      estado.mensagens = [mensagem(1)];
      const { rerender } = render(<ChatThread conversationId="c-1" />, { wrapper });
      expect(ro.cbs).toHaveLength(1);
      estado.carregando = true;
      rerender(<ChatThread conversationId="c-2" />);
      expect(ro.desligados).toBeGreaterThanOrEqual(1);
      estado.carregando = false;
      estado.mensagens = [mensagem(3)];
      rerender(<ChatThread conversationId="c-2" />);
      const ultimo = ro.cbs.length;
      expect(ultimo).toBeGreaterThanOrEqual(2);
      const sc = ro.observados[ro.observados.length - 1] as HTMLElement;
      expect(crescer(sc, 1500, [ro.cbs[ultimo - 1]!])).toBe(1500);
    } finally {
      (globalThis as { ResizeObserver: unknown }).ResizeObserver = antes;
    }
  });

  it("(Lupa 120412) a conversa VAZIA ('Nenhuma mensagem') recebe a 1ª mensagem: o observador liga", () => {
    const antes = globalThis.ResizeObserver;
    const ro = observadorFalso();
    try {
      const { rerender } = render(<ChatThread conversationId="c-1" />, { wrapper });
      const antesDaPrimeira = ro.observados.length;
      estado.mensagens = [mensagem(1)];
      rerender(<ChatThread conversationId="c-1" />);
      expect(ro.observados.length).toBeGreaterThan(antesDaPrimeira);
      const sc = ro.observados[ro.observados.length - 1] as HTMLElement;
      expect(sc.className).toContain("overflow-y-auto");
      expect(crescer(sc, 1200, ro.cbs.slice(-1))).toBe(1200);
    } finally {
      (globalThis as { ResizeObserver: unknown }).ResizeObserver = antes;
    }
  });
});
