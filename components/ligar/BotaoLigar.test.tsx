/**
 * ia.vek CRM-532 — o botão "Ligar" na tela: no celular, um link tel: com o número do cadastro (e a marca da ligação);
 * no computador, o número + Copiar + Registrar; em grupo ou sem telefone, nada.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import { BotaoLigar, EVENTO_PERGUNTAR } from "@/components/ligar/BotaoLigar";
import { lerMarca, apagarMarca } from "@/lib/ligar/marca";

function toque(sim: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: sim && q === "(pointer: coarse)",
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => apagarMarca());

describe("CRM-532: BotaoLigar", () => {
  it("no celular: o link é tel:+55… do cadastro, e tocar guarda a marca do contato/negócio/tarefa", () => {
    toque(true);
    render(<BotaoLigar contatoId="c-1" telefone="+5532984793302" leadId="l-1" tarefaId="t-1" />);
    const a = screen.getByTestId("botao-ligar");
    expect(a.getAttribute("href")).toBe("tel:+5532984793302");
    fireEvent.click(a);
    expect(lerMarca()).toMatchObject({ contatoId: "c-1", leadId: "l-1", tarefaId: "t-1" });
  });

  it("em grupo ou sem telefone, o botão não aparece", () => {
    toque(true);
    const { container: g } = render(<BotaoLigar contatoId="c" telefone="+5532984793302" ehGrupo />);
    expect(g.innerHTML).toBe("");
    const { container: s } = render(<BotaoLigar contatoId="c" telefone={null} />);
    expect(s.innerHTML).toBe("");
  });

  it("no computador: não é link tel:; abre o número grande + Copiar + 'Registrar a ligação', que pede a pergunta", () => {
    toque(false);
    const ouvido = vi.fn();
    window.addEventListener(EVENTO_PERGUNTAR, ouvido);
    render(<BotaoLigar contatoId="c-1" telefone="+5532984793302" leadId="l-1" />);
    const b = screen.getByTestId("botao-ligar");
    expect(b.getAttribute("href")).toBeNull();
    fireEvent.click(b);
    expect(screen.getByTestId("ligar-numero").textContent).toBe("+5532984793302");
    expect(screen.getByText("Copiar")).toBeTruthy();
    fireEvent.click(screen.getByText("Registrar a ligação"));
    expect(ouvido).toHaveBeenCalledTimes(1);
    expect((ouvido.mock.calls[0]![0] as CustomEvent).detail).toEqual({ contatoId: "c-1", leadId: "l-1" });
    expect(lerMarca()).toBeNull(); // no computador não há marca (não há pergunta automática)
    window.removeEventListener(EVENTO_PERGUNTAR, ouvido);
  });
});
