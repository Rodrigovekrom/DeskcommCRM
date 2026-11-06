"use client";
/**
 * ia.vek CRM-244 (Fase 2, teste J): os nomes da equipe para o balão dizer QUEM respondeu.
 * Opcional: sem provedor (a Entrada, os testes) o mapa é vazio e o balão segue "Atendente".
 * O provedor fica na gaveta da conversa do Pipeline, que já tem a lista da equipe.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";

const VAZIO: ReadonlyMap<string, string> = new Map();
const NomesDaEquipeContext = createContext<ReadonlyMap<string, string>>(VAZIO);

export function useNomesDaEquipe(): ReadonlyMap<string, string> {
  return useContext(NomesDaEquipeContext);
}

export function NomesDaEquipeProvider({ children }: { children: ReactNode }) {
  const { data } = useAssignableMembers(true);
  const nomes = useMemo(() => new Map((data ?? []).map((m) => [m.user_id, m.full_name ?? ""] as const)), [data]);
  return <NomesDaEquipeContext.Provider value={nomes}>{children}</NomesDaEquipeContext.Provider>;
}
