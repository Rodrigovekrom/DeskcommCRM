"use client";
import { useEffect, useRef } from "react";
import type { FluidDragActions, PreDragActions, SensorAPI } from "@hello-pangea/dnd";

/**
 * ia.vek v1.9.18: quando o arrasto começa. Mouse: depois de mover cerca de 8 px. Toque:
 * depois de segurar cerca de 0,5 s, para rolar a tela não virar arrasto. Esc cancela e
 * soltar fora de uma coluna devolve o cartão (o próprio dnd faz isso).
 */
export const DISTANCIA_DO_MOUSE_PX = 8;
export const ESPERA_DO_TOQUE_MS = 500;
const TOLERANCIA_DO_TOQUE_PX = 10;

const interativo = (alvo: EventTarget | null) =>
  alvo instanceof Element && !!alvo.closest("button,a,input,select,textarea,label,[role=menuitem],[role=button]");

export function useSensorDoArrasto(api: SensorAPI) {
  const limpar = useRef<(() => void) | null>(null);

  useEffect(() => {
    const encerrar = () => {
      limpar.current?.();
      limpar.current = null;
    };

    const seguirArrasto = (acoes: FluidDragActions, tirar: Array<() => void>) => {
      const ouvir = <K extends keyof WindowEventMap>(tipo: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
        window.addEventListener(tipo, f, o);
        tirar.push(() => window.removeEventListener(tipo, f, o));
      };
      const soltar = () => {
        if (acoes.isActive()) acoes.drop();
        encerrar();
      };
      const cancelar = () => {
        if (acoes.isActive()) acoes.cancel();
        encerrar();
      };
      ouvir("mousemove", (e) => acoes.move({ x: e.clientX, y: e.clientY }));
      ouvir("touchmove", (e) => {
        e.preventDefault();
        const t = e.touches[0];
        if (t) acoes.move({ x: t.clientX, y: t.clientY });
      }, { passive: false });
      ouvir("mouseup", soltar);
      ouvir("touchend", soltar);
      ouvir("touchcancel", cancelar);
      ouvir("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelar();
        }
      });
      ouvir("resize", cancelar);
    };

    const aoApertarMouse = (e: MouseEvent) => {
      if (e.button !== 0 || e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || interativo(e.target)) return;
      const id = api.findClosestDraggableId(e);
      if (!id) return;
      const pre: PreDragActions | null = api.tryGetLock(id, encerrar, { sourceEvent: e });
      if (!pre) return;
      const inicio = { x: e.clientX, y: e.clientY };
      const tirar: Array<() => void> = [];
      limpar.current = () => {
        tirar.forEach((f) => f());
        if (pre.isActive()) pre.abort();
      };
      const mover = (ev: MouseEvent) => {
        if (Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < DISTANCIA_DO_MOUSE_PX) return;
        tirar.forEach((f) => f());
        tirar.length = 0;
        ev.preventDefault();
        const acoes = pre.fluidLift({ x: ev.clientX, y: ev.clientY });
        limpar.current = () => tirar.forEach((f) => f());
        seguirArrasto(acoes, tirar);
      };
      const desistir = () => encerrar();
      window.addEventListener("mousemove", mover);
      window.addEventListener("mouseup", desistir);
      tirar.push(() => window.removeEventListener("mousemove", mover), () => window.removeEventListener("mouseup", desistir));
    };

    const aoTocar = (e: TouchEvent) => {
      if (e.defaultPrevented || e.touches.length !== 1 || interativo(e.target)) return;
      const id = api.findClosestDraggableId(e);
      if (!id) return;
      const pre = api.tryGetLock(id, encerrar, { sourceEvent: e });
      if (!pre) return;
      const t0 = e.touches[0]!;
      const inicio = { x: t0.clientX, y: t0.clientY };
      const tirar: Array<() => void> = [];
      const espera = setTimeout(() => {
        tirar.forEach((f) => f());
        tirar.length = 0;
        const acoes = pre.fluidLift(inicio);
        limpar.current = () => tirar.forEach((f) => f());
        seguirArrasto(acoes, tirar);
      }, ESPERA_DO_TOQUE_MS);
      limpar.current = () => {
        clearTimeout(espera);
        tirar.forEach((f) => f());
        if (pre.isActive()) pre.abort();
      };
      const mover = (ev: TouchEvent) => {
        const t = ev.touches[0];
        if (t && Math.hypot(t.clientX - inicio.x, t.clientY - inicio.y) > TOLERANCIA_DO_TOQUE_PX) encerrar();
      };
      const desistir = () => encerrar();
      window.addEventListener("touchmove", mover, { passive: true });
      window.addEventListener("touchend", desistir);
      window.addEventListener("touchcancel", desistir);
      tirar.push(
        () => window.removeEventListener("touchmove", mover),
        () => window.removeEventListener("touchend", desistir),
        () => window.removeEventListener("touchcancel", desistir),
      );
    };

    window.addEventListener("mousedown", aoApertarMouse);
    window.addEventListener("touchstart", aoTocar, { passive: true });
    return () => {
      window.removeEventListener("mousedown", aoApertarMouse);
      window.removeEventListener("touchstart", aoTocar);
      encerrar();
    };
  }, [api]);
}
