import type { SupabaseClient } from "@supabase/supabase-js";

import { AGENDA_DA_IA_PADRAO, lerAgendaDaIa, type AgendaDaIa } from "@/lib/iavek/agenda-da-ia";
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

export type ResultadoDoFunilDeLoja = "criado" | "ja_tinha" | "tem_funil_sem_esteira" | "falhou";

/**
 * ia.vek v1.9.54 (CRM-357): cria o funil de LOJA DE CARROS pronto (o de 72h, padrão, e o de Follow-up, com a esteira
 * DESLIGADA), pela `fn_iavek_semear_funil_loja` (migration 0636: o retrato do modelo, idempotente, trava por org).
 * NUNCA LANÇA: se falhar, a empresa fica como está, o erro vai ao log e o resultado é "falhou" (Lupa 193007 4).
 */
export async function semearFunilDaLoja(admin: SupabaseClient, organizationId: string): Promise<ResultadoDoFunilDeLoja> {
  try {
    const { data, error } = await admin.rpc("fn_iavek_semear_funil_loja", { p_org: organizationId });
    if (error) throw new Error(error.message);
    const r = (data as { resultado?: string } | null)?.resultado;
    if (r === "criado" || r === "ja_tinha" || r === "tem_funil_sem_esteira") return r;
    throw new Error(`resultado inesperado: ${String(r)}`);
  } catch (e) {
    logger.warn("[iavek-perfil] não consegui criar o funil da loja", {
      organization_id: organizationId,
      causa: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return "falhou";
  }
}

/**
 * ia.vek v1.9.2 — o que a agenda da IA precisa saber da empresa: se está no
 * modo agendamento (a IA marca) e como marca. NUNCA LANÇA: erro de leitura vale
 * "fora do modo" — a IA faz pedido, como na loja (o mais fechado).
 */
export async function agendaDaIaDaOrg(
  organizationId: string,
): Promise<{ modo: boolean; config: AgendaDaIa }> {
  try {
    const { data, error } = await createAdminClient()
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) return { modo: false, config: { ...AGENDA_DA_IA_PADRAO } };
    const settings = (data as { settings?: unknown } | null)?.settings;
    return { modo: lerPerfilDaEmpresa(settings).modo_agendamento, config: lerAgendaDaIa(settings) };
  } catch {
    return { modo: false, config: { ...AGENDA_DA_IA_PADRAO } };
  }
}
