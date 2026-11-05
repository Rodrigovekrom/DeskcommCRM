import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ia.vek v1.9.19: para onde vai o vendedor que chega a Funis ou à Entrada (um link do Meu
 * dia, do dossiê ou digitado). Não é beco sem saída: se o endereço falava de um lead ou de
 * uma conversa que ele enxerga, o Pipeline já abre aquela conversa.
 */
export async function destinoDoVendedor(
  supabase: SupabaseClient,
  orgId: string,
  alvo: { conversaId?: string | null | undefined; leadId?: string | null | undefined },
): Promise<string> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (alvo.leadId && UUID.test(alvo.leadId)) return `/app/pipeline?abrir=${alvo.leadId}`;
  if (alvo.conversaId && UUID.test(alvo.conversaId)) {
    const { data: conversa } = await supabase
      .from("conversations")
      .select("contact_id")
      .eq("id", alvo.conversaId)
      .eq("organization_id", orgId)
      .maybeSingle();
    const contato = (conversa as { contact_id?: string | null } | null)?.contact_id;
    if (contato) {
      const { data: lead } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("organization_id", orgId)
        .eq("contact_id", contato)
        .eq("status", "open")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const id = (lead as { id?: string } | null)?.id;
      if (id) return `/app/pipeline?abrir=${id}`;
    }
  }
  return "/app/pipeline";
}
