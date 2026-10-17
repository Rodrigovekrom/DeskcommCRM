/**
 * ia.vek v1.4: na Entrada de leads, a lista de conversas e as informações do
 * lead se recolhem e se abrem de novo, e o estado fica lembrado POR USUÁRIO.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import {
  chaveDoPainel,
  useAtalhosDosPaineis,
  usePainelRecolhido,
} from "@/hooks/inbox/usePainelRecolhido";
import { gradeDaInbox } from "@/components/inbox/InboxLayout";
import { NAV_CATALOG, NAV_GROUPS } from "@/lib/navigation/catalogo";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("nomes do menu (v1.4)", () => {
  it("o grupo é 'Controle de atendimentos' e o Inbox virou 'Entrada de leads'", () => {
    expect(NAV_GROUPS.find((g) => g.id === "atendimento")?.label).toBe("Controle de atendimentos");
    const entrada = NAV_CATALOG.find((i) => "href" in i && i.href === "/app/inbox");
    expect(entrada && "label" in entrada ? entrada.label : null).toBe("Entrada de leads");
  });
});

describe("gradeDaInbox", () => {
  it("aberta, mantém as larguras de sempre", () => {
    expect(gradeDaInbox(false, false)).toContain("xl:grid-cols-[272px_1fr_296px]");
    expect(gradeDaInbox(false, false)).toContain("md:grid-cols-[300px_1fr]");
  });
  it("recolhida, a coluna vira trilho e a conversa (1fr) ocupa o espaço", () => {
    expect(gradeDaInbox(true, false)).toContain("md:grid-cols-[2.5rem_1fr]");
    expect(gradeDaInbox(false, true)).toContain("xl:grid-cols-[272px_1fr_2.5rem]");
    expect(gradeDaInbox(true, true)).toContain("2xl:grid-cols-[2.5rem_1fr_2.5rem]");
  });
});

describe("usePainelRecolhido", () => {
  it("lembra o estado por usuário", () => {
    const a = renderHook(() => usePainelRecolhido("inbox-ficha", "user-a"));
    act(() => a.result.current.definir(true));
    expect(window.localStorage.getItem(chaveDoPainel("inbox-ficha", "user-a"))).toBe("1");

    // Outra pessoa no mesmo navegador não herda o layout.
    const b = renderHook(() => usePainelRecolhido("inbox-ficha", "user-b"));
    expect(b.result.current.recolhido).toBe(false);

    // A mesma pessoa, ao voltar, encontra recolhido.
    const de_novo = renderHook(() => usePainelRecolhido("inbox-ficha", "user-a"));
    expect(de_novo.result.current.recolhido).toBe(true);

    act(() => de_novo.result.current.alternar());
    expect(window.localStorage.getItem(chaveDoPainel("inbox-ficha", "user-a"))).toBeNull();
  });
});

describe("atalhos [ e ]", () => {
  function Sonda({ lista, ficha }: { lista: () => void; ficha: () => void }) {
    useAtalhosDosPaineis(lista, ficha);
    return <input aria-label="campo" />;
  }

  it("[ alterna a lista e ] alterna a ficha; dentro de campo de texto, não", () => {
    const chamadas: string[] = [];
    const { getByLabelText } = render(
      <Sonda lista={() => chamadas.push("lista")} ficha={() => chamadas.push("ficha")} />,
    );
    fireEvent.keyDown(window, { key: "[" });
    fireEvent.keyDown(window, { key: "]" });
    fireEvent.keyDown(getByLabelText("campo"), { key: "[" });
    fireEvent.keyDown(window, { key: "]", ctrlKey: true });
    expect(chamadas).toEqual(["lista", "ficha"]);
  });
});
