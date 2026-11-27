/**
 * ia.vek CRM-549 (Rodrigo 27/11, via Maestro 105656): o Kanban das 72h no celular. "Celular RECOLHIDO, PC ABERTO
 * como está."
 *  - abaixo do `md` (768px) o topo do Pipeline (contadores, seletor, busca) nasce recolhido, abre num toque e lembra
 *    a escolha no aparelho; as 3 faixas (sem dono, ajuda, compra futura) ficam SEMPRE visíveis, na ordem de antes, e
 *    o selo da linha recolhida diz o NOME do vendedor escolhido e "busca" (Lupa 111347 a e b, 112440 c);
 *  - no PC (md+) o envoltório é `md:contents` (some do layout) e o botão é `md:hidden`: a tela fica como era;
 *  - no celular sai o min-h-[28rem] (rolagem dentro de rolagem) e o quadro ganha o snap-x, desligado no arrasto.
 */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));
const membros = vi.hoisted(() => ({
  data: undefined as undefined | Array<{ user_id: string; full_name: string | null }>,
  isError: false,
  enabled: [] as boolean[],
}));
vi.mock("@/hooks/inbox/useAssignableMembers", () => ({
  useAssignableMembers: (enabled: boolean) => {
    membros.enabled.push(enabled);
    return { data: enabled ? membros.data : undefined, isError: enabled && membros.isError };
  },
}));

import {
  BotaoDoTopo,
  CHAVE_DO_TOPO,
  TopoRecolhivel,
  guardarTopo,
  topoGuardadoAberto,
  useNomeDoVendedorEscolhido,
  useTopoDoPipeline,
} from "@/components/iavek/TopoDoPipeline";

const fonte = (arq: string) => readFileSync(path.join(process.cwd(), arq), "utf8");

afterEach(() => {
  window.localStorage.clear();
  membros.data = undefined;
  membros.isError = false;
  membros.enabled = [];
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

  it("o botão só existe no celular (md:hidden), diz se está aberto e mostra o vendedor e a busca", () => {
    const alternar = vi.fn();
    const { rerender } = render(<BotaoDoTopo aberto={false} alternar={alternar} vendedor={null} comBusca={false} />);
    const botao = screen.getByTestId("botao-do-topo");
    expect(botao.className).toContain("md:hidden");
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.getAttribute("aria-controls")).toBe("topo-do-pipeline");
    expect(screen.queryByTestId("topo-vendedor")).toBeNull();
    expect(screen.queryByTestId("topo-com-busca")).toBeNull();
    fireEvent.click(botao);
    expect(alternar).toHaveBeenCalledTimes(1);
    rerender(<BotaoDoTopo aberto alternar={alternar} vendedor="Vendedor Um" comBusca />);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("topo-vendedor").textContent).toBe("Vendedor Um");
    expect(screen.getByTestId("topo-com-busca").textContent).toBe("busca");
  });

  it("o nome do vendedor vem do MESMO owner do seletor; sem escolha não pede a lista", () => {
    membros.data = [
      { user_id: "u1", full_name: "Vendedor Um" },
      { user_id: "u2", full_name: null },
    ];
    expect(renderHook(() => useNomeDoVendedorEscolhido("any")).result.current).toBeNull();
    expect(renderHook(() => useNomeDoVendedorEscolhido(undefined)).result.current).toBeNull();
    expect(membros.enabled.every((e) => e === false)).toBe(true);
    expect(renderHook(() => useNomeDoVendedorEscolhido("u1")).result.current).toBe("Vendedor Um");
    expect(renderHook(() => useNomeDoVendedorEscolhido("u2")).result.current).toBe("Sem nome");
    expect(renderHook(() => useNomeDoVendedorEscolhido("unassigned")).result.current).toBe("Sem responsável");
    expect(renderHook(() => useNomeDoVendedorEscolhido("agent:x")).result.current).toBe("Outro responsável");
    membros.data = undefined;
    expect(renderHook(() => useNomeDoVendedorEscolhido("u1")).result.current).toBe("…");
    // Lupa 112440: a lista falhou: o selo não fica em "…" para sempre.
    membros.isError = true;
    expect(renderHook(() => useNomeDoVendedorEscolhido("u1")).result.current).toBe("Outro responsável");
  });
});

describe("CRM-549: a página e o quadro (o PC fica como estava)", () => {
  const pagina = fonte("app/app/pipeline/_client.tsx");
  const quadro = fonte("components/kanban/KanbanBoard.tsx");

  it("o min-h-[28rem] vale só do md para cima (no celular ele criava a rolagem dentro da rolagem)", () => {
    expect(pagina).toContain("md:min-h-[28rem]");
    expect(pagina).not.toMatch(/[\s"]min-h-\[28rem\]/);
  });

  it("contadores, seletor e busca moram no topo que recolhe; as 3 faixas ficam SEMPRE visíveis, na ordem de antes", () => {
    const ini = pagina.indexOf("<TopoRecolhivel");
    const fim = pagina.indexOf("</TopoRecolhivel>");
    expect(ini).toBeGreaterThan(0);
    const dentro = pagina.slice(ini, fim);
    for (const parte of ["<ContadoresDoPipeline", "<SeletorDeVendedor", "<BuscaDoQuadro"]) {
      expect(dentro, parte).toContain(parte);
    }
    // Lupa 111347 (a) e 112440 (c): as 3 faixas fora do recolhido (cada uma 1 vez, depois dele) e na ORDEM da 65
    // (sem dono, ajuda, compra futura): o gerente na carteira vê duas delas, e no PC a ordem tem de ser a de antes.
    const faixas = ["<FaixaSemDono", "<FaixaDePedidosDeAjuda", "<FaixaCompraFuturaVencida"];
    for (const parte of faixas) {
      expect(dentro, parte).not.toContain(parte);
      expect(pagina.split(parte).length - 1, parte).toBe(1);
      expect(pagina.indexOf(parte), parte).toBeGreaterThan(fim);
    }
    const posicoes = faixas.map((f) => pagina.indexOf(f));
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b));
    // A mesma ordem da 65 (c0bd296c9), lida do mesmo arquivo antes da mudança: busca, sem dono, ajuda, compra futura.
    expect(pagina.indexOf("<BuscaDoQuadro")).toBeLessThan(posicoes[0]!);
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
