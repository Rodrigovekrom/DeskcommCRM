"use client";

import { useEffect, useRef } from "react";

/**
 * O fundo de rede neural da marca ia.vek: nós ligados por linhas finas que
 * derivam devagar, e um pulso âmbar que percorre a rede de nó em nó.
 *
 * Só para telas de acesso e vazias — nunca atrás de inbox, kanban ou tabela,
 * onde animação compete com o trabalho. Decorativo: `aria-hidden`, sem foco e
 * sem pointer events.
 *
 * Custo: um `<canvas>` e ~45 nós (menos em tela pequena), `requestAnimationFrame`
 * pausado com a aba oculta e desligado por completo com `prefers-reduced-motion`
 * (desenha um único quadro estático). As cores seguem o tema: linhas na cor do
 * texto em alfa baixo; o âmbar da marca (#E08A2B) é o único acento.
 */

const AMBAR = "224, 138, 43";

type No = { x: number; y: number; vx: number; vy: number; r: number };
type Pulso = { de: number; para: number; t: number };

export function FundoNeural({ className }: { readonly className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const parado = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let largura = 0;
    let altura = 0;
    let nos: No[] = [];
    let pulso: Pulso | null = null;
    let quadro = 0;
    let corLinha = "14, 27, 43";

    const lerTema = () => {
      const escuro = document.documentElement.getAttribute("data-theme") === "dark";
      corLinha = escuro ? "143, 169, 196" : "14, 27, 43";
    };

    const montar = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      largura = canvas.clientWidth;
      altura = canvas.clientHeight;
      canvas.width = Math.round(largura * dpr);
      canvas.height = Math.round(altura * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const quantidade = Math.max(16, Math.min(48, Math.round((largura * altura) / 26000)));
      nos = Array.from({ length: quantidade }, () => ({
        x: Math.random() * largura,
        y: Math.random() * altura,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: 1.2 + Math.random() * 1.6,
      }));
    };

    const vizinhos = (i: number) => {
      const alcance = Math.min(190, Math.max(120, largura / 6));
      const saida: number[] = [];
      for (let j = 0; j < nos.length; j++) {
        if (j !== i && Math.hypot(nos[i]!.x - nos[j]!.x, nos[i]!.y - nos[j]!.y) < alcance)
          saida.push(j);
      }
      return saida;
    };

    const desenhar = () => {
      ctx.clearRect(0, 0, largura, altura);
      const alcance = Math.min(190, Math.max(120, largura / 6));
      for (let i = 0; i < nos.length; i++) {
        for (let j = i + 1; j < nos.length; j++) {
          const d = Math.hypot(nos[i]!.x - nos[j]!.x, nos[i]!.y - nos[j]!.y);
          if (d < alcance) {
            ctx.strokeStyle = `rgba(${corLinha}, ${0.16 * (1 - d / alcance)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nos[i]!.x, nos[i]!.y);
            ctx.lineTo(nos[j]!.x, nos[j]!.y);
            ctx.stroke();
          }
        }
      }
      for (const n of nos) {
        ctx.fillStyle = `rgba(${corLinha}, 0.34)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (pulso) {
        const a = nos[pulso.de]!;
        const b = nos[pulso.para]!;
        const x = a.x + (b.x - a.x) * pulso.t;
        const y = a.y + (b.y - a.y) * pulso.t;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 16);
        halo.addColorStop(0, `rgba(${AMBAR}, 0.55)`);
        halo.addColorStop(1, `rgba(${AMBAR}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${AMBAR})`;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const passo = () => {
      for (const n of nos) {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > largura) n.vx *= -1;
        if (n.y < 0 || n.y > altura) n.vy *= -1;
      }
      if (!pulso) {
        const de = Math.floor(Math.random() * nos.length);
        const viz = vizinhos(de);
        if (viz.length) pulso = { de, para: viz[Math.floor(Math.random() * viz.length)]!, t: 0 };
      } else {
        pulso.t += 0.012;
        if (pulso.t >= 1) {
          const viz = vizinhos(pulso.para).filter((j) => j !== pulso!.de);
          pulso = viz.length
            ? { de: pulso.para, para: viz[Math.floor(Math.random() * viz.length)]!, t: 0 }
            : null;
        }
      }
    };

    const loop = () => {
      passo();
      desenhar();
      quadro = requestAnimationFrame(loop);
    };

    const aoMudarVisibilidade = () => {
      cancelAnimationFrame(quadro);
      if (!document.hidden && !parado) quadro = requestAnimationFrame(loop);
    };

    lerTema();
    montar();
    desenhar();
    if (!parado) quadro = requestAnimationFrame(loop);

    const observador = new ResizeObserver(() => {
      montar();
      desenhar();
    });
    observador.observe(canvas);
    const temas = new MutationObserver(() => {
      lerTema();
      if (parado) desenhar();
    });
    temas.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      cancelAnimationFrame(quadro);
      observador.disconnect();
      temas.disconnect();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className ?? "pointer-events-none absolute inset-0 h-full w-full"}
    />
  );
}
