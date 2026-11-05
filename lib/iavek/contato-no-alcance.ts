import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ia.vek v1.9.19.1: rotas que usam a chave de serviço não passam pela regra de acesso do
 * banco. Esta conferência lê pela SESSÃO, antes de usar a chave: o que a pessoa não
 * enxerga responde como inexistente.
 */
export async function contatoNoAlcance(
  sessao: SupabaseClient,
  orgId: string,
  contatoId: string,
): Promise<boolean> {
  const { data } = await sessao
    .from("contacts")
    .select("id")
    .eq("id", contatoId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return Boolean(data);
}

/** A função do membro na organização, lida pela sessão. */
export async function funcaoNaOrganizacao(
  sessao: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<unknown> {
  const { data } = await sessao
    .from("user_organizations")
    .select("interface_settings")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  return (data as { interface_settings?: { funcao?: unknown } | null } | null)?.interface_settings?.funcao ?? null;
}
