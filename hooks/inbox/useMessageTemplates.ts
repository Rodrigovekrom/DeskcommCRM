"use client";
import { usePermission } from "@/hooks/auth/AuthProvider";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useDepoisDoQuadro } from "@/lib/iavek/vez-do-quadro";

export interface MessageTemplate {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
  owner_user_id: string | null;
}

/**
 * ia.vek CRM-244 (Fase 3): as respostas mudam pouco e quem as cria invalida a chave na hora
 * (`CriarRespostaRapida`), então ficam guardadas enquanto a página está aberta: 10 min sem
 * buscar de novo. Era 60 s, e o "/" logo ao abrir a conversa esperava a busca (1,3 s).
 */
const RESPOSTAS = {
  queryKey: ["message-templates"] as const,
  queryFn: async () => apiClient.get<{ data: MessageTemplate[] }>("/api/v1/message-templates"),
  staleTime: 10 * 60_000,
};

/** Onda 5: templates de script (pessoais + compartilhados) para o slash-menu do composer. */
export function useMessageTemplates() {
  const podeConsultar = usePermission("message-templates.view");
  return useQuery({ ...RESPOSTAS, enabled: podeConsultar, select: (res) => res.data });
}

/**
 * ia.vek CRM-244 (Fase 3): o Pipeline carrega as respostas UMA vez, depois que o quadro chegou
 * (não disputa com ele), para o "/" da conversa abrir com a lista pronta. Mesma chave do composer.
 * Sem permissão a rota recusa e a lista fica vazia, como no composer.
 */
export function usePreCarregarRespostas() {
  const depoisDoQuadro = useDepoisDoQuadro();
  useQuery({ ...RESPOSTAS, enabled: depoisDoQuadro, retry: false });
}
