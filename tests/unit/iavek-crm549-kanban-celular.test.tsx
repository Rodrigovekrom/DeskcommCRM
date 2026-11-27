/**
 * ia.vek CRM-549 (Rodrigo 27/11, via Maestro 105656): o Kanban das 72h no celular. "Celular RECOLHIDO, PC ABERTO
 * como está."
 *  - abaixo do `md` (768px) o topo do Pipeline (contadores, seletor, busca, faixas) nasce recolhido, abre num toque e
 *    lembra a escolha no aparelho;
 *  - no PC (md+) o envoltório é `md:contents` (some do layout) e o botão é `md:hidden`: a tela fica como era;
 *  - no celular sai o min-h-[28rem] (rolagem dentro de rolagem) e o quadro ganha o snap-x, desligado no arrasto.
 */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

import {
  BotaoDoTopo,
  CHAVE_DO_TOPO,
  TopoRecolhivel,
  guardarTopo,
  topoGuardadoAberto,
  useTopoDoPipeline,
} from "@/components/iavek/TopoDoPipeline";

const fonte = (arq: string) => readFileSync(path.join(process.cwd(), arq), "utf8");

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("CRM-549: o topo do Pipeline no celular", () => {
  it("sem escolha guardada, nasce RECOLHIDO; a escolha fica no aparelho", () => {
    expect(topoGuardadoAberto()).toBe(false);
    guardarTopo(true);
    expect(window.localStorage.getItem(CHAVE_DO_TOPO)).toBe("aberto");
    expect(topoGuardadoAberto()).toBe(true);
    guardarTopo(false);
    expect(topoGuardadoAberto()).toBe(false);
  });

  it("sem armazenamento (aba privada, bloqueio): recolhido, e nada quebra", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(topoGuardadoAberto()).toBe(false);
    expect(() => guardarTopo(true)).not.toThrow();
  });

  it("o toque alterna e grava; quem abriu uma vez volta a encontrar aberto", () => {
    const { result } = renderHook(() => useTopoDoPipeline());
    expect(result.current.aberto).toBe(false);
    act(() => result.current.alternar());
    expect(result.current.aberto).toBe(true);
    expect(window.localStorage.getItem(CHAVE_DO_TOPO)).toBe("aberto");
    const outra = renderHook(() => useTopoDoPipeline());
    expect(outra.result.current.aberto).toBe(true);
  });

  it("recolhido, o bloco some SÓ no celular (max-md:hidden); no PC ele é md:contents, como se não existisse", () => {
    const { rerender } = render(
      <TopoRecolhivel aberto={false}>
        <p>contadores</p>
      </TopoRecolhivel>,
    );
    const bloco = screen.getByTestId("topo-do-pipeline");
    expect(bloco.className).toContain("max-md:hidden");
    expect(bloco.className).toContain("md:contents");
    rerender(
      <TopoRecolhivel aberto>
        <p>contadores</p>
      </TopoRecolhivel>,
    );
    expect(bloco.className).not.toContain("max-md:hidden");
    expect(bloco.className).toContain("md:contents");
  });

  it("o botão só existe no celular (md:hidden), diz se está aberto e avisa o filtro ativo", () => {
    const alternar = vi.fn();
    const { rerender } = render(<BotaoDoTopo aberto={false} alternar={alternar} comFiltro={false} />);
    const botao = screen.getByTestId("botao-do-topo");
    expect(botao.className).toContain("md:hidden");
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.getAttribute("aria-controls")).toBe("topo-do-pipeline");
    expect(screen.queryByTestId("topo-com-filtro")).toBeNull();
    fireEvent.click(botao);
    expect(alternar).toHaveBeenCalledTimes(1);
    rerender(<BotaoDoTopo aberto alternar={alternar} comFiltro />);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("topo-com-filtro")).toBeTruthy();
  });
});

describe("CRM-549: a página e o quadro (o PC fica como estava)", () => {
  const pagina = fonte("app/app/pipeline/_client.tsx");
  const quadro = fonte("components/kanban/KanbanBoard.tsx");

  it("o min-h-[28rem] vale só do md para cima (no celular ele criava a rolagem dentro da rolagem)", () => {
    expect(pagina).toContain("md:min-h-[28rem]");
    expect(pagina).not.toMatch(/[\s"]min-h-\[28rem\]/);
  });

  it("os contadores, o seletor, a busca e as faixas moram dentro do topo que recolhe", () => {
    const ini = pagina.indexOf("<TopoRecolhivel");
    const fim = pagina.indexOf("</TopoRecolhivel>");
    expect(ini).toBeGreaterThan(0);
    const dentro = pagina.slice(ini, fim);
    for (const parte of ["<ContadoresDoPipeline", "<SeletorDeVendedor", "<BuscaDoQuadro", "<FaixaSemDono", "<FaixaDePedidosDeAjuda", "<FaixaCompraFuturaVencida"]) {
      expect(dentro, parte).toContain(parte);
    }
    // O quadro em si fica fora: recolher o topo nunca esconde os leads.
    expect(dentro).not.toContain("<QuadroDoFunil");
  });

  it("o envoltório dos botões do header é md:contents (no PC o botão da visão fica onde estava)", () => {
    expect(pagina).toMatch(/className="flex flex-wrap items-center gap-2 md:contents"/);
  });

  it("o quadro tem snap-x só no celular, e sem ele durante o arrasto", () => {
    expect(quadro).toContain('!arrastando && "max-md:snap-x max-md:snap-mandatory"');
    // Toda classe snap-x / snap-mandatory dentro de uma string de classe é do celular (max-md:).
    const classes = (quadro.match(/"[^"\n]*snap[^"\n]*"/g) ?? []).flatMap((c) => c.slice(1, -1).split(/\s+/));
    const snaps = classes.filter((c) => /snap-(x|mandatory)/.test(c));
    expect(snaps.length).toBeGreaterThan(0);
    for (const c of snaps) expect(c, c).toMatch(/^max-md:snap-/);
    expect(quadro).toMatch(/onDragStart=\{\(\) => \{\s*congelar\(true\);\s*setArrastando\(true\);/);
    expect(quadro).toMatch(/congelar\(false\);\s*setArrastando\(false\);/);
  });

  it("a coluna segue com o snap-center (que agora tem com quem parar)", () => {
    expect(fonte("components/kanban/StageColumn.tsx")).toContain("snap-center");
  });
});
