/**
 * ia.vek v1.9.22 — consome `message.group_received`: o aviso do Venda.IA no grupo configurado
 * move o lead para Suporte IA e entrega ao próximo guardião (a regra mora no banco,
 * `fn_iavek_aviso_de_ajuda`, 0610). Aviso que não casa com lead nenhum: o lead fica onde
 * está e gerente e admin recebem no sino.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventHandler, EventRow, HandlerResult } from "@/lib/event-log/dispatcher";
import { membrosComPapel } from "@/lib/iavek/avisos-da-proposta";
import { configDoGuardiaoLeads, lerAvisoDeAjuda, type ResultadoDoAviso } from "@/lib/iavek/aviso-de-ajuda";
import { logger } from "@/lib/logger";
import { lerRemetenteDeGrupo } from "@/lib/messaging/remetente-de-grupo";
import { createAdminClient } from "@/lib/supabase/admin";

export const AVISO_DE_AJUDA_KEY = "iavek-aviso-de-ajuda";

const r = (status: HandlerResult["status"], detail: string): HandlerResult => ({
  consumer_key: AVISO_DE_AJUDA_KEY,
  status,
  detail,
});

async function avisar(db: SupabaseClient, orgId: string, destinos: string[], dados: Record<string, unknown>) {
  if (destinos.length === 0) return;
  const { error } = await db.from("notificacoes").insert(
    destinos.map((user_id) => ({ organization_id: orgId, user_id, tipo: "aviso_da_loja", ator_user_id: null, dados })),
  );
  if (error) logger.error("aviso_de_ajuda_sino_falhou", { organization_id: orgId, error: error.message });
}

export async function tratarAvisoDeAjuda(db: SupabaseClient, row: EventRow): Promise<HandlerResult> {
  const orgId = row.organization_id;
  const { data: org, error: eOrg } = await db.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (eOrg) return r("error", eOrg.message);
  const cfg = configDoGuardiaoLeads(org?.settings);
  if (!cfg) return r("skipped", "sem_configuracao");

  const conversa = typeof row.payload.conversation_id === "string" ? row.payload.conversation_id : null;
  const mensagemId = typeof row.payload.message_id === "string" ? row.payload.message_id : null;
  if (!conversa || !mensagemId) return r("skipped", "sem_mensagem");
  const { data: grupo } = await db
    .from("channel_session_groups")
    .select("id")
    .eq("organization_id", orgId)
    .eq("conversation_id", conversa)
    .eq("channel_session_id", cfg.grupo.channel_session_id)
    .eq("group_chat_id", cfg.grupo.group_chat_id)
    .maybeSingle();
  if (!grupo) return r("skipped", "outro_grupo");

  const { data: msg, error: eMsg } = await db
    .from("messages")
    .select("body, metadata")
    .eq("organization_id", orgId)
    .eq("id", mensagemId)
    .maybeSingle();
  if (eMsg) return r("error", eMsg.message);
  if (!msg) return r("skipped", "mensagem_sumiu");
  if (lerRemetenteDeGrupo(msg.metadata)?.phone !== cfg.numero_que_avisa) {
    return r("skipped", "remetente_nao_autorizado");
  }
  const leitura = lerAvisoDeAjuda(msg.body as string | null);
  if (leitura.tipo === "nao_e_aviso") return r("skipped", "nao_e_aviso");

  const { data, error } = await db.rpc("fn_iavek_aviso_de_ajuda", {
    p_org: orgId,
    p_telefones: leitura.telefones,
    p_nome: leitura.nome,
  });
  if (error) return r("error", error.message);
  const linha = ((data ?? []) as Array<{ resultado: ResultadoDoAviso; lead_id: string | null; user_id: string | null; metodo: string | null }>)[0];
  const resultado = linha?.resultado ?? "nao_reconhecido";

  if (resultado === "nao_reconhecido" || resultado === "ambiguo") {
    await avisar(db, orgId, await membrosComPapel(db, orgId, ["manager", "admin"]), {
      evento: "aviso_de_ajuda_nao_reconhecido",
      nome: leitura.nome,
      motivo: resultado,
    });
  } else if (resultado === "entregue" && linha?.user_id) {
    await avisar(db, orgId, [linha.user_id], { evento: "aviso_de_ajuda_entregue", nome: leitura.nome, lead_id: linha.lead_id });
  }
  logger.info("aviso_de_ajuda", { organization_id: orgId, resultado, metodo: linha?.metodo ?? null });
  return r("ok", `${resultado}${linha?.metodo ? `:${linha.metodo}` : ""}`);
}

export const avisoDeAjudaHandler: EventHandler = {
  key: AVISO_DE_AJUDA_KEY,
  // Loja parada não recebe lead: o aviso fica marcado como pulado e não volta na reativação.
  naOrgParada: "pula",
  events: ["message.group_received"],
  handle: (row) => tratarAvisoDeAjuda(createAdminClient(), row),
};
