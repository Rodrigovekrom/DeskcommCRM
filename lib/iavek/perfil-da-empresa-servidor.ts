import type { SupabaseClient } from "@supabase/supabase-js";

import { lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ia.vek v1.9.1 — o lado servidor do perfil da empresa.
 *
 * NUNCA LANÇA. Erro de leitura vale "fora do modo agendamento": é o
 * comportamento da loja (só o admin mexe na agenda), o mais fechado dos dois.
 */
export async function modoAgendamentoDaOrg(organizationId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient()
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) return false;
    return lerPerfilDaEmpresa((data as { settings?: unknown } | null)?.settings).modo_agendamento;
  } catch {
    return false;
  }
}

/**
 * Cria o funil padrão da clínica (idempotente: `fn_iavek_semear_funil_clinica`,
 * migration 0594, olha o slug `clinica`) e o deixa como padrão da empresa. O
 * admin edita etapas e nomes pela tela de Funis, como em qualquer funil.
 * Devolve o id do funil, ou `null` se não deu (fica no log; a troca de perfil
 * não é desfeita por isso).
 */
export async function semearFunilDaClinica(admin: SupabaseClient, organizationId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("fn_iavek_semear_funil_clinica", { p_org: organizationId });
  if (error) {
    logger.warn("[iavek-perfil] não consegui criar o funil da clínica", {
      organization_id: organizationId,
      causa: error.message,
    });
    return null;
  }
  return (data as string | null) ?? null;
}
