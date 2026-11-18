/**
 * ia.vek CRM-539: a conversa segue na última mensagem enquanto a pessoa estiver no fim (Lupa 224954: a reancoragem é
 * INSTANTÂNEA, com 2 crescimentos seguidos; a folga do "no fim" é uma constante).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { estaNoFim, FOLGA_DO_FIM_PX, useAncoraNoFim } from "@/hooks/inbox/useAncoraNoFim";

/** O ResizeObserver de mentira: guarda o callback para o teste "crescer" o conteúdo na hora que quiser. */
let callbacks: Array<() => void> = [];
let desligados = 0;
class RoFalso {
  constructor(private cb: () => void) {
    callbacks.push(cb);
  }
  observe() {}
  disconnect() {
    desligados += 1;
  }
}
const original = globalThis.ResizeObserver;

/** Um scroller com altura de janela 500 e conteúdo `altura`, rolado em `topo`. */
function scroller(altura: number, topo: number) {
  const sc = document.createElement("div");
  let h = altura;
  let janela = 500;
  let alterouTopo = 0;
  Object.defineProperty(sc, "clientHeight", { configurable: true, get: () => janela });
  Object.defineProperty(sc, "scrollHeight", { configurable: true, get: () => h });
  let t = topo;
  Object.defineProperty(sc, "scrollTop", {
    configurable: true,
    get: () => t,
    set: (v: number) => {
      // como o navegador: não passa do fim
      if (janela === 0) return; // escondido: o navegador ignora
      t = Math.min(v, h - janela);
      alterouTopo += 1;
    },
  });
  return {
    sc,
    crescer(nova: number) {
      h = nova;
      callbacks.forEach((cb) => cb());
    },
    /** display:none (0) e de volta (500): o navegador devolve o scroller no TOPO, sem evento de rolagem */
    esconder() {
      janela = 0;
      t = 0;
      callbacks.forEach((cb) => cb());
    },
    mostrar() {
      janela = 500;
      callbacks.forEach((cb) => cb());
    },
    rolarPara(novo: number) {
      t = novo;
      sc.dispatchEvent(new Event("scroll"));
    },
    get topo() {
      return t;
    },
    get vezes() {
      return alterouTopo;
    },
  };
}

beforeEach(() => {
  callbacks = [];
  desligados = 0;
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = RoFalso;
});
afterEach(() => {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = original;
});

function montar(s: ReturnType<typeof scroller>, chave = "conv-1") {
  // as refs ESTÁVEIS, como as do useRef no ChatThread
  const refScroller = { current: s.sc };
  const refConteudo = { current: document.createElement("div") };
  return renderHook(({ k, busca }) => useAncoraNoFim(refScroller, refConteudo, k, busca), {
    initialProps: { k: chave, busca: false },
  });
}

describe("CRM-539: estaNoFim (a folga é a constante)", () => {
  it("até FOLGA_DO_FIM_PX do fim conta como no fim; 1 px a mais, não", () => {
    expect(FOLGA_DO_FIM_PX).toBe(120);
    expect(
      estaNoFim({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - FOLGA_DO_FIM_PX }),
    ).toBe(true);
    expect(
      estaNoFim({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 - FOLGA_DO_FIM_PX - 1 }),
    ).toBe(false);
    // o arredondamento do celular (fração de pixel) continua no fim
    expect(estaNoFim({ scrollHeight: 1000, clientHeight: 500, scrollTop: 499.4 })).toBe(true);
  });
});

describe("CRM-539: useAncoraNoFim", () => {
  it("no fim, DOIS crescimentos seguidos (a foto e depois o cartão): cada um reancora na hora, sem animação", () => {
    const s = scroller(1000, 500); // no fim
    montar(s);
    s.crescer(1400);
    expect(s.topo).toBe(900);
    s.crescer(2100);
    expect(s.topo).toBe(1600);
    expect(s.vezes).toBe(2); // scrollTop direto (instantâneo): nada de scrollIntoView/smooth
  });

  it("a abertura: o conteúdo cresce antes de qualquer rolagem e a conversa termina na última mensagem", () => {
    const s = scroller(600, 0); // a 1ª pintura, o topo
    montar(s);
    s.crescer(1800);
    expect(s.topo).toBe(1300);
  });

  it("quem rolou para ler o histórico NÃO é arrancado de onde está", () => {
    const s = scroller(1000, 500);
    montar(s);
    s.rolarPara(100);
    s.crescer(1600);
    expect(s.topo).toBe(100);
    // voltou ao fim (dentro da folga): os crescimentos seguintes reancoram de novo
    s.rolarPara(1100 - 50);
    s.crescer(2000);
    expect(s.topo).toBe(1500);
  });

  it("outra conversa (a chave muda) começa colada no fim, mesmo se a anterior estava no meio", () => {
    const s = scroller(1000, 500);
    const r = montar(s, "conv-1");
    s.rolarPara(0);
    r.rerender({ k: "conv-2", busca: false });
    s.crescer(1500);
    expect(s.topo).toBe(1000);
    expect(desligados).toBeGreaterThanOrEqual(1); // o observador da conversa anterior foi desligado
  });

  it("sem ResizeObserver (navegador antigo), não quebra: nada reancora sozinho", () => {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = undefined;
    const s = scroller(1000, 500);
    montar(s);
    s.crescer(1500);
    expect(s.topo).toBe(500);
  });
  it("com a BUSCA ativa, nada reancora (quem procura não é arrancado da ocorrência); sem a busca, volta a valer", () => {
    const s = scroller(1000, 500);
    const r = montar(s);
    r.rerender({ k: "conv-1", busca: true });
    s.crescer(1500);
    expect(s.topo).toBe(500);
    r.rerender({ k: "conv-1", busca: false });
    s.crescer(1600);
    expect(s.topo).toBe(1100);
  });

  it("no celular, voltar de 'Dados do lead' (o scroller sai do display:none no topo) reancora quem estava no fim", () => {
    const s = scroller(1000, 500);
    montar(s);
    s.esconder();
    expect(s.topo).toBe(0);
    s.mostrar();
    expect(s.topo).toBe(500);
  });

  it("'Ir para a mais recente': aparece longe do fim e, ao tocar, leva ao fim e volta a colar", () => {
    const s = scroller(1000, 500);
    const r = montar(s);
    expect(r.result.current.noFim).toBe(true);
    act(() => s.rolarPara(100));
    expect(r.result.current.noFim).toBe(false);
    act(() => r.result.current.irAoFim());
    expect(r.result.current.noFim).toBe(true);
    expect(s.topo).toBe(500);
    s.crescer(1300);
    expect(s.topo).toBe(800);
  });

  it("'carregar antigas' (a pessoa está no topo): o conteúdo que cresce em cima NÃO a leva ao fim", () => {
    const s = scroller(1000, 500);
    montar(s);
    s.rolarPara(0);
    s.crescer(1800);
    expect(s.topo).toBe(0);
  });
});
