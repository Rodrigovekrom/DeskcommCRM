import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * ia.vek v1.8.1 — a conversa abre NA GAVETA do quadro, não na Entrada.
 *
 * 1. Dentro de um quadro (contexto publicado), o atalho do cartão chama a gaveta
 *    com o id do LEAD e não navega — nem link, nem rota de abrir conversa.
 * 2. Lead sem conversa, mas com contato: o atalho também abre a gaveta (que diz
 *    "ainda não tem conversa" e oferece iniciar).
 * 3. Fora do quadro (ficha do contato), o atalho continua sendo o link de sempre.
 * 4. Cerca de fonte: a gaveta envia pelo MESMO Composer da Entrada e não tem
 *    caminho de envio próprio.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ConversaNoQuadroContext } from "@/components/iavek/conversa-no-quadro-contexto";
import { ConversaSlot } from "@/components/kanban/ConversaSlot";
import { ConversaNoDossie } from "@/components/kanban/ConversaNoDossie";

const conversa = { id: "conv-1", preview: "Quero ver o carro", last_message_at: "2026-10-22T10:00:00Z", unread: 2 };

function montar(ui: React.ReactElement, abrir: ((id: string) => void) | null) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ConversaNoQuadroContext.Provider value={abrir}>{ui}</ConversaNoQuadroContext.Provider>
    </QueryClientProvider>,
  );
}

describe("v1.8.1 — conversa na gaveta do quadro", () => {
  it("no quadro, o atalho do cartão abre a gaveta com o id do lead, sem link para a Entrada", () => {
    const abrir = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    montar(<ConversaSlot conversa={conversa} contactId="c1" phone="+5515999990000" leadId="lead-1" />, abrir);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByTestId("abrir-conversa-no-quadro"));
    expect(abrir).toHaveBeenCalledWith("lead-1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("2")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("lead sem conversa, com contato: também abre a gaveta (ela oferece iniciar)", () => {
    const abrir = vi.fn();
    montar(<ConversaSlot conversa={null} contactId="c1" phone="+5515999990000" leadId="lead-2" />, abrir);
    fireEvent.click(screen.getByTestId("abrir-conversa-no-quadro"));
    expect(abrir).toHaveBeenCalledWith("lead-2");
  });

  it("no dossiê dentro do quadro, o bloco da conversa abre a gaveta", () => {
    const abrir = vi.fn();
    montar(<ConversaNoDossie conversa={conversa} contactId="c1" phone="+5515999990000" leadId="lead-3" />, abrir);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByTestId("abrir-conversa-no-quadro-dossie"));
    expect(abrir).toHaveBeenCalledWith("lead-3");
  });

  it("fora do quadro, o atalho continua sendo o link para a Entrada", () => {
    montar(<ConversaSlot conversa={conversa} contactId="c1" phone="+5515999990000" leadId="lead-1" />, null);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/inbox?id=conv-1");
  });

  it("a gaveta usa o Composer, o cabeçalho e o histórico da Entrada — sem rota de envio própria", () => {
    const bruta = readFileSync(join(process.cwd(), "components/iavek/ConversaNoQuadro.tsx"), "utf8");
    // Sem comentários: a cerca mede o código, não a explicação.
    const fonte = bruta.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(fonte).toContain('from "@/components/inbox/Composer"');
    expect(fonte).toContain('from "@/components/inbox/ConversationHeader"');
    expect(fonte).toContain('from "@/components/inbox/ChatThread"');
    expect(fonte).toContain("motivoDaJanelaFechada");
    expect(fonte).toContain("motivoDoContato");
    // Nenhum envio feito à mão: mensagem só sai pelo Composer.
    expect(fonte).not.toMatch(/\/messages/);
    expect(fonte).not.toMatch(/useSendMessage|useUploadMedia|sent_via/);
    // O único POST da gaveta é o "Iniciar conversa", pela rota de sempre.
    const posts = [...fonte.matchAll(/apiClient\.post[^(]*\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(posts).toEqual(["/api/v1/conversations/open-with-contact"]);
  });
});
