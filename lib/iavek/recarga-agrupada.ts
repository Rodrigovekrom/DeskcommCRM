/**
 * ia.vek v1.9.51.4 (Lupa 192902, Maestro 192916): as recargas que SEGUEM o quadro, agrupadas.
 *
 * MEDIDO no canário (13/11, a SDR de teste): um clique em 'Assumir' ou 'Troca?' no Pipeline fazia 1 escrita e 11
 * leituras: o quadro 2x, o painel 3x, o selo do padrão 3x e a faixa sem dono 3x. Cada recarga do quadro (a da própria
 * ação e a do eco dela pelo tempo real) puxava de novo o painel, o selo e a faixa, cada um por conta própria. Na rede
 * lenta da SDR essa fila passava dos 10 s do apiClient e tudo caía junto.
 *
 * `criarRecargaAgrupada`: muitos pedidos seguidos viram UMA recarga, quando os pedidos param por `esperaMs`; e nunca
 * mais tarde que `tetoMs` depois do 1º pedido da leva (uma rajada sem fim não deixa a tela parada). Sem dependência.
 */
import { useCallback, useEffect, useRef } from "react";

export const ESPERA_DA_RECARGA_MS = 2_000;
export const TETO_DA_RECARGA_MS = 4_000;

export interface RecargaAgrupada {
  pedir(): void;
  cancelar(): void;
}

export function criarRecargaAgrupada(
  recarregar: () => void,
  opcoes: {
    esperaMs?: number;
    tetoMs?: number;
    agora?: () => number;
    agendar?: (fn: () => void, ms: number) => unknown;
    desagendar?: (t: unknown) => void;
  } = {},
): RecargaAgrupada {
  const esperaMs = opcoes.esperaMs ?? ESPERA_DA_RECARGA_MS;
  const tetoMs = opcoes.tetoMs ?? TETO_DA_RECARGA_MS;
  const agora = opcoes.agora ?? Date.now;
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const desagendar = opcoes.desagendar ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let primeiroPedido: number | null = null;

  const disparar = () => {
    timer = null;
    primeiroPedido = null;
    recarregar();
  };

  return {
    pedir() {
      const t = agora();
      if (primeiroPedido === null) primeiroPedido = t;
      if (timer !== null) desagendar(timer);
      const ate = Math.min(esperaMs, Math.max(0, primeiroPedido + tetoMs - t));
      timer = agendar(disparar, ate);
    },
    cancelar() {
      if (timer !== null) desagendar(timer);
      timer = null;
      primeiroPedido = null;
    },
  };
}

/** A versão de componente: a função mais nova sempre (ref atualizada num efeito); a leva criada no 1º pedido (fora do
 * render) e cancelada ao desmontar. */
export function useRecargaAgrupada(recarregar: () => void, opcoes: { esperaMs?: number; tetoMs?: number } = {}): () => void {
  const fn = useRef(recarregar);
  useEffect(() => {
    fn.current = recarregar;
  }, [recarregar]);
  const { esperaMs, tetoMs } = opcoes;
  const leva = useRef<RecargaAgrupada | null>(null);
  useEffect(
    () => () => {
      leva.current?.cancelar();
      leva.current = null;
    },
    [],
  );
  return useCallback(() => {
    leva.current ??= criarRecargaAgrupada(() => fn.current(), {
      ...(esperaMs !== undefined ? { esperaMs } : {}),
      ...(tetoMs !== undefined ? { tetoMs } : {}),
    });
    leva.current.pedir();
  }, [esperaMs, tetoMs]);
}
