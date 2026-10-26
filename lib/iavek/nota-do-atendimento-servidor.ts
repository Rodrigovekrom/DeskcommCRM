import type { SupabaseClient } from "@supabase/supabase-js";

import { extrairTextoDoArquivo } from "@/lib/ai/rag/ingest/documento";
import { CRITERIOS_PADRAO, TITULO_DOS_CRITERIOS, lerConfigDaNota } from "@/lib/iavek/nota-do-atendimento";
import { logger } from "@/lib/logger";

/**
 * ia.vek v1.8.4 — o lado servidor da nota do atendimento.
 *
 * O FECHAR humano passa pela chave de serviço (`fn_service_status`), então um
 * gatilho no banco não saberia quem fechou. Quem emite o evento é a ROTA, logo
 * depois do fechamento dar certo, com o id de quem clicou. O worker consome.
 * Com a chave da loja desligada, nada é emitido (nenhuma linha na fila).
 *
 * NUNCA LANÇA: a avaliação é acessória. Fechar a conversa não pode falhar por
 * causa dela.
 */
export async function avisarFechamentoHumano(
  admin: SupabaseClient,
  alvo: { organizationId: string; conversationId: string; fechadoPor: string },
): Promise<void> {
  try {
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", alvo.organizationId)
      .maybeSingle();
    if (!lerConfigDaNota((org as { settings?: unknown } | null)?.settings).ativo) return;
    const { error } = await admin.rpc("emit_event", {
      p_event_type: "conversation.closed",
      p_entity_kind: "conversation",
      p_entity_id: alvo.conversationId,
      p_payload: { conversation_id: alvo.conversationId, closed_by_user_id: alvo.fechadoPor },
      p_metadata: { origem: "iavek.nota_do_atendimento" },
      p_organization_id: alvo.organizationId,
    });
    if (error) {
      logger.warn("[iavek-nota] não consegui pôr o fechamento na fila", {
        organization_id: alvo.organizationId,
        conversation_id: alvo.conversationId,
        causa: error.message,
      });
    }
  } catch (err) {
    logger.warn("[iavek-nota] falha ao avisar o fechamento", {
      organization_id: alvo.organizationId,
      causa: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Os critérios em vigor: o material do Acervo com o título fixo, se existir e
 * estiver ativo; senão, o texto padrão. Documento colado (Storage) ou FAQ.
 */
export async function lerCriteriosDoAcervo(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ texto: string; doAcervo: boolean }> {
  try {
    const { data: fontes } = await admin
      .from("ai_knowledge_sources")
      .select("id, name, source_type, source_metadata, status")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .ilike("name", TITULO_DOS_CRITERIOS)
      .limit(1);
    const fonte = (fontes ?? [])[0] as
      | { id: string; source_type: string | null; source_metadata: Record<string, unknown> | null; status: string | null }
      | undefined;
    if (!fonte || fonte.status === "archived") return { texto: CRITERIOS_PADRAO, doAcervo: false };

    const blob = typeof fonte.source_metadata?.blob_path === "string" ? fonte.source_metadata.blob_path : null;
    if (blob) {
      const ext = typeof fonte.source_metadata?.ext === "string" ? fonte.source_metadata.ext : undefined;
      const { texto } = await extrairTextoDoArquivo(blob, ext);
      if (texto.trim()) return { texto: texto.trim().slice(0, 8000), doAcervo: true };
    }
    const { data: faq } = await admin
      .from("ai_faq_items")
      .select("question, answer, position")
      .eq("organization_id", organizationId)
      .eq("knowledge_source_id", fonte.id)
      .order("position", { ascending: true });
    const linhas = ((faq ?? []) as Array<{ question: string | null; answer: string | null }>)
      .map((f) => [f.question, f.answer].filter(Boolean).join(": "))
      .filter(Boolean);
    if (linhas.length > 0) return { texto: linhas.join("\n").slice(0, 8000), doAcervo: true };
  } catch (err) {
    logger.warn("[iavek-nota] não consegui ler os critérios do Acervo; uso o padrão", {
      organization_id: organizationId,
      causa: err instanceof Error ? err.message : String(err),
    });
  }
  return { texto: CRITERIOS_PADRAO, doAcervo: false };
}
