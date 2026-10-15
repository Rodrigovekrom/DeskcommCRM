// COLUNA DO QUADRO COM TOM SÓLIDO POR ETAPA (#119).
//
// A coluna usava `bg-surface-muted/40`, token que o `globals.css` nunca declarou:
// a classe não gerava regra e a coluna saía transparente. Este arquivo guarda os
// dois lados do conserto — a coluna (e o cabeçalho preso) levam a classe que
// pinta o fundo sólido com o nível da etapa, e a regra existe no CSS.

import fs from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { DragDropContext } from "@hello-pangea/dnd";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
vi.mock("@/components/kanban/KanbanCard", () => ({ KanbanCard: () => null }));

import { StageColumn } from "@/components/kanban/StageColumn";
import type { Stage } from "@/lib/kanban/types";

const etapa = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  pipeline_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Proposta",
  position: 1,
  color: null,
} as unknown as Stage;

function montar(nivel?: number) {
  const { container } = render(
    <DragDropContext onDragEnd={() => {}}>
      <StageColumn stage={etapa} leads={[]} pipelineId={etapa.pipeline_id} nivel={nivel} />
    </DragDropContext>,
  );
  const coluna = container.querySelector<HTMLElement>("[data-etapa-do-quadro]")!;
  const cabecalho = container.querySelector<HTMLElement>("[data-cabecalho-da-etapa]")!;
  return { coluna, cabecalho };
}

describe("coluna do quadro com tom sólido por etapa", () => {
  it("a coluna e o cabeçalho preso levam a classe do tom, e o nível vai na coluna", () => {
    const { coluna, cabecalho } = montar(0.75);
    expect(coluna.classList.contains("coluna-da-etapa")).toBe(true);
    expect(cabecalho.classList.contains("coluna-da-etapa")).toBe(true);
    expect(coluna.style.getPropertyValue("--nivel-da-etapa")).toBe("0.75");
  });

  it("sem nível, a coluna fica no tom da primeira etapa", () => {
    expect(montar().coluna.style.getPropertyValue("--nivel-da-etapa")).toBe("0");
  });

  it("nenhum componente do quadro volta a usar o token que não existe", () => {
    const pasta = path.join(process.cwd(), "components/kanban");
    const comFundoFantasma = fs
      .readdirSync(pasta)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /\bbg-surface-muted\//.test(fs.readFileSync(path.join(pasta, f), "utf8")));
    expect(comFundoFantasma).toEqual([]);
  });

  it("a regra do tom existe no CSS, sólida e com a progressão por nível nos dois temas", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const claro = css.match(/\n\.coluna-da-etapa \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const escuro = css.match(/\[data-theme="dark"\] \.coluna-da-etapa \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(claro).toContain("background-color: var(--color-surface-elevated);");
    for (const bloco of [claro, escuro]) {
      expect(bloco).toContain("color-mix(");
      expect(bloco).toContain("var(--nivel-da-etapa, 0)");
    }
  });
});
