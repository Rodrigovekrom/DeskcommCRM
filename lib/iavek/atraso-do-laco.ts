/**
 * ia.vek v1.9.51.4 (Lupa 192902 c, Maestro 192916): o ATRASO DO LAÇO do app (event loop delay) no log.
 *
 * O app é 1 processo Node: um pedido pesado (CPU) prende todos os outros. Se nas janelas dos cliques lentos o laço
 * atrasar, a culpa é do app; se ficar baixo, é a rede da pessoa. Mede com `monitorEventLoopDelay` (do próprio Node,
 * sem custo que se veja) em janelas de 5 s:
 *  - a cada 5 s, UMA linha `laco_do_app` SÓ se o maior atraso da janela passou de `LIMIAR_MS` (50 ms);
 *  - a cada 1 min, SEMPRE uma linha `laco_do_app_minuto` com o p50, o p99 e o máximo do minuto.
 * (Uma linha a cada 5 s, sempre, dobraria o log do app, que hoje guarda ~10 dias em 3 x 10 MB: MEDIDO 116 KB/h.)
 * Desliga com IAVEK_LACO_DO_APP=0. Nada de dado de cliente: só números.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";

import { logger } from "@/lib/logger";

export const JANELA_MS = 5_000;
export const LIMIAR_MS = 50;
export const JANELAS_POR_MINUTO = 12;

const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;

export type LinhaDoLaco = { p50_ms: number; p99_ms: number; max_ms: number };

export function resumirHistograma(h: Pick<IntervalHistogram, "percentile" | "max" | "count">): LinhaDoLaco | null {
  if (!h.count) return null;
  return { p50_ms: ms(h.percentile(50)), p99_ms: ms(h.percentile(99)), max_ms: ms(h.max) };
}

let ligado = false;

/** Liga uma vez por processo (o register do Next pode rodar mais de uma vez em desenvolvimento). */
export function ligarAtrasoDoLaco(env: Record<string, string | undefined> = process.env): boolean {
  if (ligado || env.IAVEK_LACO_DO_APP === "0") return false;
  ligado = true;
  const janela = monitorEventLoopDelay({ resolution: 20 });
  const minuto = monitorEventLoopDelay({ resolution: 20 });
  janela.enable();
  minuto.enable();
  let n = 0;
  const t = setInterval(() => {
    const r = resumirHistograma(janela);
    janela.reset();
    if (r && r.max_ms >= LIMIAR_MS) logger.warn("laco_do_app", { ...r, janela_s: JANELA_MS / 1000 });
    if (++n >= JANELAS_POR_MINUTO) {
      n = 0;
      const m = resumirHistograma(minuto);
      minuto.reset();
      if (m) logger.info("laco_do_app_minuto", m);
    }
  }, JANELA_MS);
  t.unref?.();
  return true;
}
