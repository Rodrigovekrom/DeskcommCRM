/**
 * POST /api/v1/iavek/pipeline/assumir — ia.vek v1.7.7. Corpo: `{ lead_id }`.
 *
 * O vendedor ASSUME um lead que chegou sem dono, e ele entra na carteira dele.
 *
 * O caminho segue o dono da CONVERSA, como o resto do sistema:
 *   1. Se o contato tem conversa aberta SEM atendente, ela é assumida pela
 *      mesma RPC do "Assumir conversa" (`fn_conversation_assign`, com trava
 *      otimista e evento de atribuição) — e o gatilho da 0579
 *      (`fn_iavek_lead_segue_a_conversa`) leva o lead junto.
 *   2. Se a conversa já é de OUTRA pessoa, recusa: o lead tem de ficar com quem
 *      atende o cliente.
 *   3. Sem conversa (lead criado à mão, importado), o dono é gravado direto, e
 *      só se o lead ainda estiver sem dono.
 *
 * Dois vendedores clicando ao mesmo tempo: o segundo recebe 409 ("outro
 * vendedor já assumiu") — os dois updates são condicionais a "sem dono".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ lead_id: z.uuid() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const eu = authz.user.id;

  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  // Pela SESSÃO: se a pessoa não enxerga o lead, para ela ele não existe.
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select("id, contact_id, status, owner_user_id, owner_agent_id")
    .eq("organization_id", orgId)
    .eq("id", corpo.data.lead_id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!lead) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  if (lead.owner_user_id === eu) return ok({ lead_id: lead.id, ja_era_seu: true }, { requestId });
  if (lead.status !== "open") {
    return fail("state_conflict", t("Este lead não está mais aberto."), 409, { requestId });
  }
  if (lead.owner_user_id || lead.owner_agent_id) {
    return fail("state_conflict", t("Outro vendedor já assumiu este lead."), 409, { requestId });
  }

  let caminho: "conversa" | "lead" = "lead";
  if (lead.contact_id) {
    const { data: conversa } = await supabase
      .from("conversations")
      .select("id, assigned_to_user_id, contact_id")
      .eq("organization_id", orgId)
      .eq("contact_id", lead.contact_id)
      .eq("is_group", false)
      .neq("status", "archived")
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (conversa?.assigned_to_user_id && conversa.assigned_to_user_id !== eu) {
      return fail("state_conflict", t("A conversa deste cliente já é de outra pessoa."), 409, { requestId });
    }
    if (conversa && !conversa.assigned_to_user_id) {
      const { data: assumida, error: erroRpc } = await supabase.rpc("fn_conversation_assign", {
        p_organization_id: orgId,
        p_conversation_id: conversa.id,
        p_to_user_id: eu,
        p_reason: "claim",
        p_enforce_expected: true,
      });
      if (erroRpc) return fail("internal_error", erroRpc.message, 500, { requestId });
      if (!assumida?.[0]) {
        return fail("state_conflict", t("Outro vendedor já assumiu este lead."), 409, { requestId });
      }
      caminho = "conversa";
      await registrarTrocaDeComando({
        supabase,
        organizationId: orgId,
        conversationId: conversa.id,
        contactId: conversa.contact_id,
        tipo: "conversation_claimed",
        actor: { type: "user", id: eu, role: authz.org.role },
        motivo: "Assumiu o lead pelo Pipeline",
      });
    }
  }

  // Sem conversa — ou para garantir: o gatilho só move lead aberto e sem dono
  // daquele contato; o update condicional fecha o caso do lead sem contato.
  const { data: gravado, error: erroUpdate } = await supabase
    .from("crm_leads")
    .update({ owner_user_id: eu, owner_agent_id: null, owner_kind: "user", assigned_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", lead.id)
    .is("owner_user_id", null)
    .is("owner_agent_id", null)
    .select("id")
    .maybeSingle();
  if (erroUpdate) return fail("internal_error", erroUpdate.message, 500, { requestId });
  if (!gravado) {
    const { data: depois } = await supabase
      .from("crm_leads")
      .select("owner_user_id")
      .eq("organization_id", orgId)
      .eq("id", lead.id)
      .maybeSingle();
    if (depois?.owner_user_id !== eu) {
      return fail("state_conflict", t("Outro vendedor já assumiu este lead."), 409, { requestId });
    }
  }

  void audit({
    action: "iavek.lead_assumido",
    actorUserId: eu,
    organizationId: orgId,
    resourceType: "crm_leads",
    resourceId: lead.id,
    requestId,
    metadata: { caminho },
  });
  return ok({ lead_id: lead.id, caminho }, { requestId });
}
