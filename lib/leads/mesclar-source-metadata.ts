/**
 * ia.vek v1.9.43 (0616, P3 da Lupa): grava chaves no `crm_leads.source_metadata` com `||` NO BANCO.
 *
 * Ler o objeto, juntar a chave aqui e regravar o objeto inteiro APAGA o que outra escrita gravou no
 * meio (o WhatsApp gravando waha_lid, a atribuição do anúncio). `fn_iavek_mesclar_source_metadata`
 * faz `coalesce(source_metadata, '{}') || patch` numa instrução só. É SECURITY INVOKER: vale o RLS
 * do cliente que chama, como no UPDATE direto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function mesclarSourceMetadata(
  db: SupabaseClient,
  orgId: string,
  leadId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>)("fn_iavek_mesclar_source_metadata", {
    p_org: orgId,
    p_lead: leadId,
    p_patch: patch,
  });
  if (error) return { ok: false, erro: error.message.slice(0, 200) };
  if (data !== true) return { ok: false, erro: "lead não encontrado na organização" };
  return { ok: true };
}
