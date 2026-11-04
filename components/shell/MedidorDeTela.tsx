"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { chamadasEmVoo } from "@/lib/api/client";
import { caminhoSemDados, type Medida } from "@/lib/iavek/medidas-de-tela";

/**
 * ia.vek v1.9.16: a medição real por tela, no ar. Não desenha nada. Mede o tempo até a
 * tela ficar útil (sem caixas de carregando e com conteúdo), os cliques, e avisa quando
 * uma tela fica presa, com o que ela está esperando. Só tempos e caminhos sem dados.
 */
const PRESA_MS = [10_000, 30_000];
const DESISTE_MS = 60_000;
const ESPIADA_MS = 100;
const SELETOR_CARREGANDO = "main .animate-pulse";

function enviar(m: Medida): void {
  try {
    const corpo = new Blob([JSON.stringify(m)], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/v1/iavek/medidas", corpo)) {
      void fetch("/api/v1/iavek/medidas", { method: "POST", body: corpo, keepalive: true }).catch(() => {});
    }
  } catch {
    /* medir nunca atrapalha */
  }
}

function telaEstaUtil(): boolean {
  const main = document.querySelector("main");
  return !!main && !main.querySelector(SELETOR_CARREGANDO) && (main.textContent?.trim().length ?? 0) > 20;
}

function chamadasDesde(inicio: number) {
  return (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
    (e) => e.startTime >= inicio && e.initiatorType === "fetch",
  );
}

function resumoDeChamadas(inicio: number): Pick<Medida, "chamadas" | "paginas" | "lentas"> {
  const todas = chamadasDesde(inicio);
  const paginas = todas.filter((e) => e.name.includes("_rsc=")).length;
  const api = todas.filter((e) => e.name.includes("/api/v1/") && !e.name.includes("/iavek/medidas"));
  const lentas = [...api]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 3)
    .map((e) => ({ c: caminhoSemDados(e.name), ms: Math.round(e.duration) }));
  return { chamadas: api.length, paginas, lentas };
}

function emVooAgora(): NonNullable<Medida["em_voo"]> {
  const agora = Date.now();
  return chamadasEmVoo()
    .filter((c) => !c.caminho.includes("/iavek/medidas"))
    .slice(0, 8)
    .map((c) => ({ c: caminhoSemDados(c.caminho), ms: Math.min(agora - c.desde, 600_000) }));
}

function presa(tela: string, ms: number, destino?: string): void {
  enviar({
    tipo: "preso",
    tela,
    ...(destino ? { destino } : {}),
    ms: Math.round(ms),
    em_voo: emVooAgora(),
    online: navigator.onLine,
    visivel: !document.hidden,
  });
}

export function MedidorDeTela() {
  const pathname = usePathname();
  const clique = useRef<{ em: number; destino: string } | null>(null);
  const primeira = useRef(true);
  const faixas = useRef({ ate_300: 0, ate_1000: 0, acima: 0 });
  const maiorAtraso = useRef(0);
  const telaAtual = useRef(pathname);

  // A tela nova: abrir (primeira) ou menu (depois de um clique num link).
  useEffect(() => {
    telaAtual.current = pathname;
    const eraPrimeira = primeira.current;
    primeira.current = false;
    const inicio = eraPrimeira ? 0 : (clique.current?.em ?? performance.now());
    clique.current = null;
    const tela = caminhoSemDados(pathname);
    const avisos = [...PRESA_MS];
    let seguidas = 0;
    const espiada = setInterval(() => {
      const ms = performance.now() - inicio;
      if (document.hidden) return;
      if (telaEstaUtil()) {
        if (++seguidas < 2) return;
        clearInterval(espiada);
        enviar({ tipo: eraPrimeira ? "abrir" : "menu", tela, ms: Math.round(ms), ...resumoDeChamadas(inicio) });
        return;
      }
      seguidas = 0;
      if (avisos[0] !== undefined && ms >= avisos[0]) {
        avisos.shift();
        presa(tela, ms);
      }
      if (ms >= DESISTE_MS) clearInterval(espiada);
    }, ESPIADA_MS);
    return () => clearInterval(espiada);
  }, [pathname]);

  // Os cliques: quanto tempo até as chamadas que ele disparou terminarem.
  useEffect(() => {
    const aoClicar = (ev: MouseEvent) => {
      const alvo = ev.target as Element | null;
      const link = alvo?.closest?.("a[href]") as HTMLAnchorElement | null;
      const inicio = performance.now();
      if (link && link.origin === location.origin && !link.target) {
        const destino = caminhoSemDados(link.pathname);
        if (link.pathname !== location.pathname) {
          clique.current = { em: inicio, destino };
          // O clique no menu que não troca de tela: é o carregando sem fim da página.
          for (const espera of PRESA_MS) {
            setTimeout(() => {
              if (clique.current?.em === inicio) presa(caminhoSemDados(telaAtual.current), espera, destino);
            }, espera);
          }
          return;
        }
      }
      if (!alvo?.closest?.("button,[role=button],[role=tab],[role=radio],[role=option],select,a")) return;
      const emVooAntes = new Set(chamadasEmVoo());
      let espiadas = 0;
      const espiada = setInterval(() => {
        espiadas++;
        const novas = chamadasEmVoo().filter((c) => !emVooAntes.has(c));
        const passou = performance.now() - inicio;
        if ((novas.length > 0 && passou < 30_000) || espiadas < 2) return;
        clearInterval(espiada);
        const ms = chamadasDesde(inicio).length > 0 ? passou - ESPIADA_MS : 0;
        const f = faixas.current;
        if (ms <= 300) f.ate_300++;
        else if (ms <= 1000) f.ate_1000++;
        else f.acima++;
        if (ms > 1000) {
          enviar({ tipo: "clique", tela: caminhoSemDados(telaAtual.current), ms: Math.round(ms), ...resumoDeChamadas(inicio) });
        }
      }, ESPIADA_MS);
    };
    document.addEventListener("click", aoClicar, { capture: true, passive: true });

    // O navegador travado: o maior atraso entre uma interação e a resposta na tela.
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) maiorAtraso.current = Math.max(maiorAtraso.current, Math.round(e.duration));
      });
      obs.observe({ type: "event", durationThreshold: 200, buffered: false } as PerformanceObserverInit);
    } catch {
      obs = null;
    }

    const aoSair = () => {
      if (!document.hidden) return;
      const f = faixas.current;
      if (f.ate_300 + f.ate_1000 + f.acima === 0) return;
      enviar({
        tipo: "resumo",
        tela: caminhoSemDados(telaAtual.current),
        ms: Math.round(performance.now()),
        cliques: { ...f },
        maior_atraso_ms: maiorAtraso.current,
      });
      faixas.current = { ate_300: 0, ate_1000: 0, acima: 0 };
      maiorAtraso.current = 0;
    };
    document.addEventListener("visibilitychange", aoSair);
    return () => {
      document.removeEventListener("click", aoClicar, { capture: true });
      document.removeEventListener("visibilitychange", aoSair);
      obs?.disconnect();
    };
  }, []);

  return null;
}
