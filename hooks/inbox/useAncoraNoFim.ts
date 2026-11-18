"use client";
/**
 * ia.vek CRM-539: a conversa abre (e continua) na ÚLTIMA mensagem enquanto a pessoa estiver no fim.
 *
 * O defeito (o feedback do Lucas, 17/11): ao abrir, o fio ancora no fim com o conteúdo da 1ª pintura. As fotos, os
 * áudios, as prévias de link e os cartões que chegam DEPOIS fazem o conteúdo crescer, e a última mensagem fica abaixo
 * da dobra. O efeito de ancoragem do ChatThread só roda quando muda o NÚMERO de itens, então não vê esse crescimento.
 *
 * A regra:
 *   - `colado` diz se a pessoa está no fim (a distância até o fim ≤ FOLGA_DO_FIM_PX);
 *   - ele começa `true` em cada conversa nova (`chave`);
 *   - cada rolagem da PESSOA o recalcula;
 *   - um ResizeObserver no CONTEÚDO reancora no fim a cada crescimento, mas só enquanto `colado`;
 *   - quem rolou para ler o histórico não é arrancado de onde está, e vê "Ir para a mais recente";
 *   - com a BUSCA ativa, nada reancora;
 *   - o scroller que volta do display:none (o celular, ao sair de "Dados do lead") reancora se estava no fim.
 *
 * A reancoragem é INSTANTÂNEA (`scrollTop` direto), nunca smooth (Lupa 224954). Uma animação no meio de outro
 * crescimento deixaria a tela "pulando" e, no meio dela, a medida da distância daria a falsa leitura de que a pessoa
 * saiu do fim.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * A folga para considerar que a pessoa está "no fim", em px. O celular arredonda o scrollTop (frações de pixel, a
 * barra do navegador que some e volta), então "exatamente no fim" quase nunca é 0. É a MESMA folga da guarda de
 * distância do ChatThread (a de "quem rolou para ler o histórico").
 */
export const FOLGA_DO_FIM_PX = 120;

/** A pessoa está no fim do scroller, dentro da folga? */
export function estaNoFim(
  sc: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  folga = FOLGA_DO_FIM_PX,
): boolean {
  return sc.scrollHeight - sc.scrollTop - sc.clientHeight <= folga;
}

export interface AncoraNoFim {
  /** A pessoa está no fim agora? (a mesma leitura do `colado`, em estado, para o botão "Ir para a mais recente") */
  noFim: boolean;
  /** Leva ao fim na hora e volta a colar (o botão). */
  irAoFim: () => void;
}

/**
 * @param scrollerRef o elemento que rola (o fio)
 * @param conteudoRef o conteúdo dentro dele, que cresce
 * @param chave a conversa: outra chave começa colada no fim
 * @param pausado com a BUSCA ativa, nada reancora (quem procura não é arrancado da ocorrência)
 */
export function useAncoraNoFim(
  scrollerRef: RefObject<HTMLElement | null>,
  conteudoRef: RefObject<HTMLElement | null>,
  chave: string,
  pausado = false,
): AncoraNoFim {
  const colado = useRef(true);
  const pausa = useRef(pausado);
  useEffect(() => {
    pausa.current = pausado;
  }, [pausado]);
  // o "no fim" vale por conversa: outra chave começa no fim sem um setState dentro do efeito
  const [lido, setLido] = useState({ chave, noFim: true });
  const noFim = lido.chave === chave ? lido.noFim : true;

  useEffect(() => {
    colado.current = true;
    const sc = scrollerRef.current;
    const ct = conteudoRef.current;
    if (!sc || !ct) return;

    const aoRolar = () => {
      // Escondido (display:none no celular, ao abrir "Dados do lead"): não há posição de verdade para ler.
      if (sc.clientHeight === 0) return;
      colado.current = estaNoFim(sc);
      setLido({ chave, noFim: colado.current });
    };
    sc.addEventListener("scroll", aoRolar, { passive: true });

    // Sem ResizeObserver (navegador muito antigo): fica só a ancoragem do ChatThread, como antes.
    if (typeof ResizeObserver === "undefined") {
      return () => sc.removeEventListener("scroll", aoRolar);
    }
    // O CONTEÚDO cresce (a foto, o cartão, a nota) e o SCROLLER volta a ter altura (saindo do display:none, ele
    // reaparece no topo): nos dois casos, quem estava no fim volta ao fim, na hora.
    const ro = new ResizeObserver(() => {
      if (colado.current && !pausa.current && sc.clientHeight > 0) sc.scrollTop = sc.scrollHeight;
    });
    ro.observe(ct);
    ro.observe(sc);
    return () => {
      ro.disconnect();
      sc.removeEventListener("scroll", aoRolar);
    };
  }, [scrollerRef, conteudoRef, chave]);

  const irAoFim = useCallback(() => {
    const sc = scrollerRef.current;
    colado.current = true;
    setLido({ chave, noFim: true });
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [scrollerRef, chave]);

  return { noFim, irAoFim };
}
