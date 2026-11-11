/**
 * ia.vek v1.9.45 (CRM-294, decisão (c) do Rodrigo, DESLIGADA até o ok): quando o lead vai para Compra
 * futura, o GUARDIÃO dele (crm_leads.sdr_user_id) é avisado por push, se não foi ele mesmo quem moveu.
 * Liga em settings.iavek.compra_futura.avisar_guardiao. Nunca derruba o movimento: falhar só registra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { enviarPushAoUsuario } from "@/lib/notifications/web_push";

export function avisarGuardiaoLigado(settings: unknown): boolean {
  const v = (settings as { iavek?: { compra_futura?: { avisar_guardiao?: unknown } } } | null)?.iavek?.compra_futura?.avisar_guardiao;
  return v === true;
}

export async function avisarGuardiaoDaCompraFutura(
  admin: Pick<SupabaseClient, "from">,
  params: { orgId: string; leadId: string; titulo: string; guardiaoId: string | null; quemMoveu: string; mes: string | null },
): Promise<"avisou" | "desligado" | "sem_guardiao" | "foi_o_guardiao" | "falhou"> {
  try {
    if (!params.guardiaoId) return "sem_guardiao";
    if (params.guardiaoId === params.quemMoveu) return "foi_o_guardiao";
    const { data: org } = await admin.from("organizations").select("settings").eq("id", params.orgId).maybeSingle();
    if (!avisarGuardiaoLigado((org as { settings?: unknown } | null)?.settings)) return "desligado";
    const mes = params.mes ? `${params.mes.slice(5, 7)}/${params.mes.slice(0, 4)}` : "";
    await enviarPushAoUsuario(params.orgId, params.guardiaoId, {
      title: "Lead em Compra futura",
      body: `${params.titulo.slice(0, 90)}${mes ? ` · previsto para ${mes}` : ""}`,
      tag: `compra-futura:${params.leadId}`,
      href: "/app/pipeline",
    });
    return "avisou";
  } catch (err) {
    logger.warn("compra_futura_aviso_ao_guardiao_falhou", {
      organization_id: params.orgId,
      lead_id: params.leadId,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
    });
    return "falhou";
  }
}
