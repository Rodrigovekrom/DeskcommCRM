import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { corrigeVenda } from "@/lib/iavek/funcoes";
import { lerVendaDaLoja } from "@/lib/iavek/venda-da-loja";
import { lojaPedeDadosDaVenda } from "@/lib/iavek/venda-da-loja-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { recusaDeMotivoDaPerdaPeloBanco } from "@/lib/leads/motivo-da-perda";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ia.vek v1.9.19 (CRM-234): corrigir o valor e a data de um lead JÁ vendido, na loja de
 * carros. Só gerente e admin; a recusa também está no banco (0606), para valer em todo
 * caminho. A organização vem da sessão, nunca do corpo, e a correção vai à auditoria.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const { id: leadId } = await ctx.params;
  if (!UUID.test(leadId)) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  const supabase = await createClient();
  const { data: membro } = await supabase
    .from("user_organizations")
    .select("role, interface_settings")
    .eq("organization_id", orgId)
    .eq("user_id", authz.user.id)
    .is("revoked_at", null)
    .maybeSingle();
  const vinculo = membro as { role?: string; interface_settings?: { funcao?: unknown } | null } | null;
  if (!corrigeVenda(vinculo?.interface_settings?.funcao, vinculo?.role)) {
    return fail("venda_so_gerente", t("Só gerente e admin corrigem o valor e a data da venda."), 403, {
      requestId,
    });
  }
  if (!(await lojaPedeDadosDaVenda(supabase, orgId))) {
    return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  }

  const corpo = (await req.json().catch(() => null)) as { venda?: unknown } | null;
  const venda = lerVendaDaLoja(corpo?.venda, authz.user.idioma);
  if (!venda.ok) return fail(venda.codigo, venda.mensagem, 422, { requestId });

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, status, value_cents, closed_at")
    .eq("id", leadId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const atual = lead as { status: string; value_cents: number | null; closed_at: string | null } | null;
  if (!atual) return fail("not_found", t("Lead não encontrado."), 404, { requestId });
  if (atual.status !== "won") {
    return fail("lead_nao_vendido", t("Este lead não está vendido."), 409, { requestId });
  }

  const { error } = await supabase
    .from("crm_leads")
    .update({ value_cents: venda.valorCents, closed_at: venda.fechadoEm })
    .eq("id", leadId)
    .eq("organization_id", orgId);
  if (error) {
    const recusa = recusaDeMotivoDaPerdaPeloBanco(error, authz.user.idioma);
    if (recusa) {
      return fail(recusa.codigo, recusa.mensagem, recusa.codigo === "venda_so_gerente" ? 403 : 422, {
        requestId,
      });
    }
    return fail("internal_error", t("Falha ao corrigir a venda."), 500, { requestId });
  }

  await audit({
    action: "lead.venda_corrigida",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_lead",
    resourceId: leadId,
    requestId,
    metadata: {
      valor_antes_cents: atual.value_cents,
      valor_depois_cents: venda.valorCents,
      data_antes: atual.closed_at,
      data_depois: venda.fechadoEm,
    },
  });
  return ok({ id: leadId, value_cents: venda.valorCents, closed_at: venda.fechadoEm }, { requestId });
}
