"use client";
/**
 * ia.vek CRM-532 (decisão do Rodrigo 17/11): esta pessoa liga pelo CRM? Decidido UMA vez no layout do servidor (a função
 * REAL do vínculo + a lista da loja, `ligaPeloCrm` em lib/ligar/regras.ts) e lido pelo botão. Sem o provedor, `false`:
 * o botão não aparece (o lado seguro).
 */
import { createContext, useContext } from "react";

const Ctx = createContext(false);
export const LigarProvider = Ctx.Provider;
export function useLigaPeloCrm(): boolean {
  return useContext(Ctx);
}
