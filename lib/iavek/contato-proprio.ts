/**
 * ia.vek v1.7.6 — "o PRÓPRIO lead ou cliente" de quem atende.
 *
 * Decisão do dono do produto (21/10/2026): vendedor e SDR ligam pelo sistema
 * só para o próprio lead/cliente; o admin liga para qualquer um. O gerente não
 * liga para a carteira dos outros (estratégia é do admin).
 *
 * "Meu" = sou o dono (`owner_user_id`) ou o SDR guardião (`sdr_user_id`,
 * migration 0579) de algum negócio do contato, ou a conversa do contato está
 * atribuída a mim. Usa o client que a rota passar, sempre filtrando a
 * organização à mão.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { roleAtLeast } from "@/lib/auth/types";

export async function ehContatoProprio(
  db: SupabaseClient,
  args: { orgId: string; contatoId: string; userId: string },
): Promise<boolean> {
  const { orgId, contatoId, userId } = args;
  const [leads, conversas] = await Promise.all([
    db
      .from("crm_leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("contact_id", contatoId)
      .or(`owner_user_id.eq.${userId},sdr_user_id.eq.${userId}`),
    db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("contact_id", contatoId)
      .eq("assigned_to_user_id", userId),
  ]);
  return (leads.count ?? 0) > 0 || (conversas.count ?? 0) > 0;
}

/** 403 pronto quando quem não é admin tenta ligar para contato que não é seu. */
export async function exigirContatoProprioParaLigar(
  db: SupabaseClient,
  args: {
    orgId: string;
    contatoId: string | null;
    userId: string;
    role: string;
    requestId: string;
  },
): Promise<Response | null> {
  if (roleAtLeast(args.role, "admin")) return null;
  const recusa = () =>
    fail("forbidden", "Você só liga para lead ou cliente seu.", 403, { requestId: args.requestId });
  if (!args.contatoId) return recusa();
  const meu = await ehContatoProprio(db, {
    orgId: args.orgId,
    contatoId: args.contatoId,
    userId: args.userId,
  });
  return meu ? null : recusa();
}
