/**
 * ia.vek v1.9.52.4 (Maestro 072000/073112; desenho aprovado pela Lupa 073050): a conversa que um atendimento
 * (re)abre e fica SEM DONO volta NA HORA ao SDR de Follow-up do lead.
 *
 * Por quê: reabrir uma conversa fechada zera o dono no banco (o gatilho `fn_service_stamp_status`; medido no canário em
 * 14/11) e a fila passa a vê-la, inclusive o SDR de antes, que a regra do Rodrigo manda não ver. A reconciliação da
 * esteira (a cada rodada) é a REDE; isto fecha a janela no instante da abertura.
 *
 * Só age quando TUDO vale: a conversa está aberta, SEM dono e SEM IA ativa; a org NÃO tem atendimento automático no ar
 * (`orgTemAutomatico === false`; indefinido = tem, não mexe); e o lead ABERTO mais novo do contato no funil do
 * Follow-up (settings.esteira.followup.pipeline_id) é de um SDR de Follow-up ATIVO. Usa a transferência de sempre
 * (`fn_conversation_assign`, motivo 'transfer'). NUNCA derruba o atendimento: erro vai ao log e segue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { logger } from "@/lib/logger";

export async function conversaSemDonoVoltaAoFollowup(
  admin: SupabaseClient,
  orgId: string,
  contactId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data: conversa } = await admin
      .from("conversations")
      .select("assigned_to_user_id, active_ai_agent_id, status")
      .eq("organization_id", orgId)
      .eq("id", conversationId)
      .maybeSingle();
    const c = conversa as { assigned_to_user_id: string | null; active_ai_agent_id: string | null; status: string } | null;
    if (!c || c.assigned_to_user_id || c.active_ai_agent_id || ["closed", "resolved", "archived"].includes(c.status)) return false;

    const { data: org } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const funil = (org as { settings?: { esteira?: { followup?: { pipeline_id?: string } } } } | null)?.settings?.esteira?.followup
      ?.pipeline_id;
    if (!funil) return false;

    const { data: lead } = await admin
      .from("crm_leads")
      .select("owner_user_id")
      .eq("organization_id", orgId)
      .eq("contact_id", contactId)
      .eq("pipeline_id", funil)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const dono = (lead as { owner_user_id: string | null } | null)?.owner_user_id;
    if (!dono) return false;

    const { data: membro } = await admin
      .from("user_organizations")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", dono)
      .is("revoked_at", null)
      .eq("interface_settings->>funcao", "sdr_followup")
      .maybeSingle();
    if (!membro) return false;

    if ((await orgTemAutomatico(admin, orgId)) !== false) return false;

    const { error } = await admin.rpc("fn_conversation_assign", {
      p_organization_id: orgId,
      p_conversation_id: conversationId,
      p_to_user_id: dono,
      p_reason: "transfer",
      p_enforce_expected: false,
    });
    if (error) {
      logger.warn("conversa_reaberta_nao_voltou_ao_followup", { organization_id: orgId, conversation_id: conversationId, causa: error.message.slice(0, 200) });
      return false;
    }
    logger.info("conversa_reaberta_voltou_ao_followup", { organization_id: orgId, conversation_id: conversationId });
    return true;
  } catch (e) {
    logger.warn("conversa_reaberta_nao_voltou_ao_followup", { organization_id: orgId, conversation_id: conversationId, causa: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
