/**
 * POST /api/v1/iavek/padrao/marcar — ia.vek v1.8.0. Corpo: `{ lead_id, item_id, feito }`.
 *
 * A marcação de 1 toque do vendedor ("fotos externas enviadas", "vídeo com o
 * nome do cliente"). Só o DONO do lead (ou gerente/admin) marca, e só se a
 * conversa já tiver a mídia mínima do item — conferida AQUI, no servidor, e
 * não na tela. Grava `custom_fields.iavek_padrao_<item>` pelo merge atômico.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { chaveDaMarcacao } from "@/lib/iavek/padrao-da-loja";
import { avaliarLeads, carregarPadrao, COLUNAS_DO_LEAD_DO_PADRAO, type LeadDoPadrao } from "@/lib/iavek/padrao-da-loja-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const corpoSchema = z.object({ lead_id: z.uuid(), item_id: z.string().min(1).max(40), feito: z.boolean() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  const admin = createAdminClient();
  const padrao = await carregarPadrao(admin, authz.org.orgId);
  const item = padrao.itens.find((i) => i.id === corpo.data.item_id);
  if (!padrao.ativo || !item || item.tipo !== "marcacao") {
    return fail("validation_failed", t("Este item do padrão não se marca por aqui."), 422, { requestId });
  }

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("crm_leads")
    .select(COLUNAS_DO_LEAD_DO_PADRAO)
    .eq("organization_id", authz.org.orgId)
    .eq("id", corpo.data.lead_id)
    .maybeSingle();
  if (!lead) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  const l = lead as LeadDoPadrao;
  if (l.owner_user_id !== authz.user.id && !roleAtLeast(authz.org.role, "manager")) {
    return fail("forbidden", t("Só o vendedor dono do lead marca o padrão dele."), 403, { requestId });
  }

  if (corpo.data.feito) {
    const avaliado = (await avaliarLeads(admin, authz.org.orgId, padrao, [l])).get(l.id);
    const bloqueio = avaliado?.itens.find((i) => i.id === item.id)?.bloqueio;
    if (bloqueio) {
      return fail("validation_failed", `${t("Ainda não dá para marcar")}: ${bloqueio}.`, 422, { requestId, details: { bloqueio } });
    }
  }

  const { error } = await admin.rpc("fn_lead_anotar_campos", {
    p_org: authz.org.orgId,
    p_lead: l.id,
    p_campos: { [chaveDaMarcacao(item.id)]: corpo.data.feito ? new Date().toISOString() : null },
  });
  if (error) return fail("internal_error", t("Não consegui gravar a marcação."), 500, { requestId });
  void audit({
    action: "iavek.padrao_marcado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_leads",
    resourceId: l.id,
    requestId,
    metadata: { item: item.id, feito: corpo.data.feito },
  });
  return ok({ lead_id: l.id, item_id: item.id, feito: corpo.data.feito }, { requestId });
}
