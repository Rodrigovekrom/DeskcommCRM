/**
 * ia.vek v1.9.26 — A VEZ DO QUADRO.
 *
 * Ao entrar no Pipeline, a tela disparava ~11 pedidos de uma vez, e o board (o único que desenha os
 * cartões) esperava na fila do navegador: medido no canário, ~1,1 s parado antes de sair, porque o
 * navegador só abre 6 conexões por servidor em HTTP/1.1. Este sinal deixa o board passar primeiro:
 * os pedidos que NÃO desenham o cartão (sino, avisos de venda, contadores da caixa, presença,
 * histórico de chamadas) esperam o board chegar.
 *
 * Nada deixa de carregar: a espera acaba quando o board chega (com sucesso ou erro), e há um teto
 * de tempo (`TETO_MS`) para que nenhum pedido fique preso se o board nunca vier. Fora das telas de
 * quadro não há espera nenhuma.
 */
import { useSyncExternalStore } from "react";

/** Teto: depois disto, tudo segue, com ou sem board. */
export const TETO_MS = 4000;

/** Telas em que o board é o que a pessoa veio ver. */
export function telaDeQuadro(caminho: string): boolean {
  return caminho === "/app/pipeline" || /^\/app\/pipelines\/[^/]+\/?$/.test(caminho);
}

let esperando = false;
let teto: ReturnType<typeof setTimeout> | null = null;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const o of ouvintes) o();
}

/** Abre a vez do quadro (os outros pedidos passam a esperar). */
export function abrirVezDoQuadro(): void {
  if (teto) clearTimeout(teto);
  esperando = true;
  teto = setTimeout(liberarDepoisDoQuadro, TETO_MS);
  avisar();
}

/** O board chegou (ou falhou, ou o teto venceu): os outros pedidos seguem. */
export function liberarDepoisDoQuadro(): void {
  if (teto) clearTimeout(teto);
  teto = null;
  if (!esperando) return;
  esperando = false;
  avisar();
}

// Na carga da página já se sabe se é tela de quadro: abre a vez antes de qualquer componente montar.
if (typeof window !== "undefined" && telaDeQuadro(window.location.pathname)) abrirVezDoQuadro();

/** `true` quando os pedidos que não desenham o cartão podem sair. */
export function podeSeguir(): boolean {
  return !esperando;
}

function assinar(o: () => void) {
  ouvintes.add(o);
  return () => ouvintes.delete(o);
}

/**
 * `true` quando o pedido pode sair. No servidor (e na hidratação) é `false`: nenhum pedido sai
 * antes de o navegador saber em que tela está.
 */
export function useDepoisDoQuadro(): boolean {
  return useSyncExternalStore(
    assinar,
    podeSeguir,
    () => false,
  );
}

/** Só para testes. */
export function __reiniciarVezDoQuadro(): void {
  if (teto) clearTimeout(teto);
  teto = null;
  esperando = false;
  ouvintes.clear();
}
