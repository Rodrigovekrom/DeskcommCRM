"use client";

import { createContext } from "react";

/**
 * ia.vek v1.8.1 — quem está num quadro (Kanban) publica isto; o atalho de
 * conversa do cartão e do dossiê o chama em vez de navegar para a Entrada, e a
 * conversa abre na gaveta do quadro (`ConversaNoQuadro`). Fora de um quadro (a
 * ficha do contato, por exemplo) o contexto é nulo e o atalho segue sendo o
 * link de sempre.
 *
 * Mora num módulo à parte para o cartão não carregar o Composer só para saber
 * se há gaveta.
 */
export const ConversaNoQuadroContext = createContext<((leadId: string) => void) | null>(null);
