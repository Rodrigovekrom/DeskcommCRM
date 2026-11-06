"use client";
/**
 * ia.vek CRM-244 (Fase 2): ao abrir e ao fechar a conversa, registra que ESTA pessoa a viu
 * (POST /api/v1/conversations/[id]/aberta). Zera na hora as não lidas dela no quadro (otimista)
 * e recarrega o quadro para a conta exata. Não mexe no contador de mais ninguém.
 */
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiClient } from "@/lib/api/client";
import type { Lead } from "@/lib/types/leads";

export function zerarNoQuadro(qc: QueryClient, conversaId: string) {
  qc.setQueriesData<{ leads?: Lead[] } | undefined>({ queryKey: ["board"] }, (atual) => {
    if (!atual?.leads) return atual;
    let mudou = false;
    const leads = atual.leads.map((l) => {
      if (l.conversa?.id !== conversaId || !l.conversa.nao_lidas) return l;
      mudou = true;
      return { ...l, conversa: { ...l.conversa, nao_lidas: 0 } };
    });
    return mudou ? { ...atual, leads } : atual;
  });
}

export function marcarAbertura(qc: QueryClient, conversaId: string): Promise<void> {
  zerarNoQuadro(qc, conversaId);
  return apiClient
    .post(`/api/v1/conversations/${conversaId}/aberta`, {})
    .then(() => qc.invalidateQueries({ queryKey: ["board"] }))
    .catch(() => undefined);
}

export function useAberturaDaConversa(conversaId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!conversaId) return;
    void marcarAbertura(qc, conversaId);
    // Ao fechar, o "visto até" vira a hora de fechar: o que chegou com a conversa aberta foi lido.
    return () => void marcarAbertura(qc, conversaId);
  }, [qc, conversaId]);
}
