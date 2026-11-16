/**
 * ia.vek v1.9.59.2: a janela "Por que este lead sai do Perdido?" só confirma com o motivo (mínimo 3 letras, sem
 * contar espaços), manda o texto aparado, e o quadro a abre antes de mover para uma etapa aberta.
 */
import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReabrirLeadDialog, motivoDeReaberturaValido } from "@/components/kanban/ReabrirLeadDialog";

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
}

afterEach(cleanup);

describe("v1.9.59.2: a janela do motivo para sair do Perdido", () => {
  it("⭐ sem motivo (ou com menos de 3 letras) não confirma; com motivo, manda o texto aparado", () => {
    const onConfirm = vi.fn();
    render(<ReabrirLeadDialog open onOpenChange={() => {}} onConfirm={onConfirm} />);
    expect(screen.getByText("Por que este lead sai do Perdido?")).toBeTruthy();
    const confirmar = screen.getByRole("button", { name: "Confirmar" }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("motivo-reabertura"), { target: { value: "  ab  " } });
    expect(confirmar.disabled).toBe(true);
    fireEvent.click(confirmar);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("motivo-reabertura"), { target: { value: "  Voltou a falar  " } });
    expect(confirmar.disabled).toBe(false);
    fireEvent.click(confirmar);
    expect(onConfirm).toHaveBeenCalledWith("Voltou a falar");
  });

  it("a regra do texto", () => {
    expect(motivoDeReaberturaValido("")).toBe(false);
    expect(motivoDeReaberturaValido("   ")).toBe(false);
    expect(motivoDeReaberturaValido("abc")).toBe(true);
    expect(motivoDeReaberturaValido("x".repeat(501))).toBe(false);
  });

  it("o quadro abre a janela ao sair do Perdido e também quando o servidor pede o motivo", () => {
    const quadro = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    expect(quadro).toMatch(
      /\(lead\.status === "lost" \|\| lead\.status === "won"\) && !etapa\.is_lost && !etapa\.is_won\) \{\s*setReaberturaPendente\(args\)/,
    );
    expect(quadro).toMatch(/onMotivoDaReabertura: setReaberturaPendente/);
    expect(quadro).toMatch(/motivoReabertura: motivo/);
    const hook = readFileSync("hooks/kanban/useMoveCard.ts", "utf8");
    expect(hook).toMatch(/motivo_reabertura: args\.motivoReabertura/);
    expect(hook).toMatch(/err\.code === "motivo_da_reabertura_obrigatorio" && opcoes\.onMotivoDaReabertura/);
  });
});

describe("v1.9.59.2: desfazer depois de vendido (a mesma janela, do Vendido)", () => {
  it("⭐ com de=\"won\" o título é o do Vendido; sem a prop segue o do Perdido", () => {
    const { unmount } = render(<ReabrirLeadDialog open de="won" onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText("Por que este lead sai do Vendido?")).toBeTruthy();
    expect(screen.queryByText("Por que este lead sai do Perdido?")).toBeNull();
    unmount();
    render(<ReabrirLeadDialog open onOpenChange={() => {}} onConfirm={() => {}} />);
    expect(screen.getByText("Por que este lead sai do Perdido?")).toBeTruthy();
  });

  it("⭐ o aviso 'Movido para Vendido' agora tem Desfazer, e a janela do motivo sabe que o lead é do Vendido", () => {
    const quadro = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");
    // o ramo antigo (Vendido sem Desfazer) saiu: o mesmo aviso, com a ação, para todo destino
    expect(quadro).not.toMatch(/if \(destino\.is_won\) \{\s*toast\.success\([^)]*\{ duration: 8000 \}\);\s*return;/);
    expect(quadro).toMatch(/const aviso = destino\.is_won \? toast\.success : toast;\s*aviso\(/);
    expect(quadro).toMatch(/label: t\("Desfazer"\)/);
    // o Desfazer do Vendido cai no 422 do servidor, e a janela olha o status do lead no quadro
    expect(quadro).toMatch(/de=\{\s*data\?\.leads\.find\(\(l\) => l\.id === reaberturaPendente\.leadId\)\?\.status === "won" \? "won" : "lost"/);
    // e o Desfazer de quem saiu do Vendido, na loja, volta pela janela da venda (valor e data)
    expect(quadro).toMatch(/if \(voltaParaOVendido && lojaDeCarros\) \{\s*setVendaPendente\(/);
  });
});
