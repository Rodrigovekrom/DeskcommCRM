"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * ia.vek v1.4: painel que se recolhe e se abre de novo, com o estado lembrado
 * POR USUÁRIO neste navegador (princípio do Rodrigo: CRM limpo e ajustável).
 *
 * É conveniência de quem usa, e não dado do sistema: por isso fica no
 * `localStorage`, com a chave levando o id do usuário (duas pessoas no mesmo
 * computador não herdam o layout uma da outra). Toda leitura e escrita é
 * protegida: em janela anônima ou com o armazenamento bloqueado o painel só
 * deixa de ser lembrado, e nunca quebra a tela.
 *
 * Nasce ABERTO e só depois lê o lembrado: ler no primeiro render divergiria do
 * HTML do servidor (hidratação).
 */
export function chaveDoPainel(painel: string, userId: string): string {
  return `iavek:painel-recolhido:${painel}:${userId}`;
}

export function usePainelRecolhido(painel: string, userId: string | null | undefined) {
  const [recolhido, setRecolhido] = useState(false);

  useEffect(() => {
    if (!userId) return;
    try {
      setRecolhido(window.localStorage.getItem(chaveDoPainel(painel, userId)) === "1");
    } catch {
      // armazenamento indisponível: segue aberto.
    }
  }, [painel, userId]);

  const definir = useCallback(
    (valor: boolean) => {
      setRecolhido(valor);
      if (!userId) return;
      try {
        if (valor) window.localStorage.setItem(chaveDoPainel(painel, userId), "1");
        else window.localStorage.removeItem(chaveDoPainel(painel, userId));
      } catch {
        // sem armazenamento: vale só nesta visita.
      }
    },
    [painel, userId],
  );

  const alternar = useCallback(() => definir(!recolhido), [definir, recolhido]);

  return { recolhido, definir, alternar };
}

/** O alvo do teclado é um campo de texto? (aí "[" e "]" são texto, não atalho) */
function eCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  if (alvo.isContentEditable) return true;
  const tag = alvo.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Atalhos "[" (lista de conversas) e "]" (informações do lead). Ficam fora de
 * campo de texto e de qualquer combinação com Ctrl/Cmd/Alt.
 */
export function useAtalhosDosPaineis(aoAlternarLista: () => void, aoAlternarFicha: () => void) {
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (eCampoDeTexto(e.target)) return;
      if (e.key === "[") {
        e.preventDefault();
        aoAlternarLista();
      } else if (e.key === "]") {
        e.preventDefault();
        aoAlternarFicha();
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoAlternarLista, aoAlternarFicha]);
}
