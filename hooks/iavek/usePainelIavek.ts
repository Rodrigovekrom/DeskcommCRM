"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { Cronometro } from "@/lib/iavek/cronometro-72h";

/** ia.vek v1.5: lead ativo, cronômetro das 72h e próximo passo do contato. */
export interface PainelIavek {
  lead: { id: string; title: string; pipeline_id: string } | null;
  cronometro: Cronometro | null;
  proximo_passo: { id: string; title: string; due_date: string | null } | null;
}

export function chaveDoPainelIavek(contactId: string | null | undefined) {
  return ["iavek", "painel", contactId ?? null] as const;
}

export function buscarPainelIavek(contactId: string): Promise<PainelIavek> {
  return apiClient
    .get<{ data: PainelIavek }>(`/api/v1/contacts/${contactId}/painel-iavek`)
    .then((r) => r.data);
}

export function usePainelIavek(contactId: string | null | undefined) {
  return useQuery({
    queryKey: chaveDoPainelIavek(contactId),
    queryFn: () => buscarPainelIavek(contactId as string),
    enabled: Boolean(contactId),
    staleTime: 60_000,
  });
}
