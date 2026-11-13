/**
 * ia.vek v1.9.51.2 (Rodrigo 13/11 ~17:25Z): "na visão de gerente, quando estiver analisando, aparecer o que a pessoa
 * está mandando, independente de quem seja, só para não perder tempo clicando no áudio".
 *
 * Todo áudio vira texto: o do cliente e o do celular já viravam (quem pede é o media-persist-worker, que emite o
 * `media.derive_requested` depois de guardar a mídia que chega pelo WhatsApp). O áudio que o vendedor manda PELA TELA do
 * CRM sobe direto ao storage (rota /conversations/[id]/media) e NUNCA passava por esse caminho: ficava sem texto
 * (420 em 7 dias na Fenômenos, medido em 13/11). Aqui o envio pela tela pede a mesma transcrição. O balão do áudio já
 * mostra a "Transcrição" para qualquer direção quando o status é `ready` (MediaRenderer).
 *
 * Nunca bloqueia o envio: se o pedido falhar, a mensagem segue, o status vira `failed` (para o balão não ficar
 * "transcrevendo" para sempre) e o motivo vai ao log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

type AudioDaTela = {
  id: string;
  organization_id: string;
  type: string | null;
  sent_via: string | null;
  media_storage_path: string | null;
};

/** Só o ÁUDIO, enviado pela TELA (sent_via 'user'), com o arquivo no storage. */
export function deveTranscreverAudioDaTela(m: Pick<AudioDaTela, "type" | "sent_via" | "media_storage_path">): boolean {
  return m.type === "audio" && m.sent_via === "user" && !!m.media_storage_path;
}

export async function pedirTranscricaoDoAudioDaTela(admin: SupabaseClient, m: AudioDaTela): Promise<"pedido" | "ignorado" | "falhou"> {
  if (!deveTranscreverAudioDaTela(m)) return "ignorado";
  try {
    const { error } = await admin.rpc("emit_event" as never, {
      p_event_type: "media.derive_requested",
      p_entity_kind: "message",
      p_entity_id: m.id,
      p_payload: { message_id: m.id },
      p_metadata: { source: "envio_pela_tela" },
      p_organization_id: m.organization_id,
    } as never);
    if (!error) return "pedido";
    logger.warn("[audio-da-tela] o pedido de transcrição falhou (o envio segue)", { message_id: m.id, detail: error.message });
  } catch (err) {
    logger.warn("[audio-da-tela] o pedido de transcrição falhou (o envio segue)", {
      message_id: m.id,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  // Sem o pedido ninguém vai transcrever: marca o fim, para o balão não esperar um texto que não vem.
  await admin
    .from("messages")
    .update({ media_derived_status: "failed" })
    .eq("id", m.id)
    .eq("organization_id", m.organization_id)
    .then(() => undefined, () => undefined);
  return "falhou";
}
