import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { logger } from "@/lib/logger";

// Arquivo próprio (CRM-244 Fase 2): o handler de leads também o usa, e `passagem-servidor` importa
// o handler de leads; aqui não há ciclo. `passagem-servidor` o reexporta para os chamadores de sempre.
/**
 * A CONVERSA vai junto com o lead: sem isto o novo dono abria "Conversa não
 * encontrada ou fora do seu acesso" (a conversa seguia atribuída ao SDR). O
 * guardião continua vendo — a RLS deixa o SDR ler as conversas dos contatos
 * que guarda (`fn_iavek_contatos_que_guardo`). O MESMO caminho da transferência
 * da tela (`fn_conversation_assign`, motivo `transfer`).
 */
export async function passarAConversa(
  admin: SupabaseClient,
  args: { orgId: string; contactId: string | null; para: string | null; actor: Actor; motivo: string },
): Promise<void> {
  if (!args.contactId || !args.para) return;
  const { data: conversa } = await admin
    .from("conversations")
    .select("id, assigned_to_user_id")
    .eq("organization_id", args.orgId)
    .eq("contact_id", args.contactId)
    .eq("is_group", false)
    .neq("status", "archived")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const c = conversa as { id: string; assigned_to_user_id: string | null } | null;
  if (!c || c.assigned_to_user_id === args.para) return;
  const { error } = await admin.rpc("fn_conversation_assign", {
    p_organization_id: args.orgId,
    p_conversation_id: c.id,
    p_to_user_id: args.para,
    p_reason: "transfer",
    p_enforce_expected: false,
  });
  if (error) {
    logger.warn("[iavek-passagem] a conversa não foi junto com o lead", {
      organization_id: args.orgId,
      conversation_id: c.id,
      causa: error.message.slice(0, 200),
    });
    return;
  }
  await registrarTrocaDeComando({
    supabase: admin,
    organizationId: args.orgId,
    conversationId: c.id,
    contactId: args.contactId,
    tipo: "conversation_transferred",
    actor: args.actor,
    motivo: args.motivo,
  });
}
