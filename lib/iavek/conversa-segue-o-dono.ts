/**
 * ia.vek CRM-244 (Fase 2, correção aprovada pelo Maestro em 06/11): trocar o responsável do cartão
 * leva a CONVERSA junto para o novo dono, pela MESMA regra da passagem (`passarAConversa`:
 * `fn_conversation_assign` com motivo `transfer` e a linha "Transferiu a conversa" no histórico).
 * Sem isso o novo dono não enxergava a conversa (404) e o cartão chegava a ele sem conversa, sem
 * bloco e sem contador.
 *
 * Guarda: só move a conversa que JÁ está com uma pessoa, e com outra que não o novo dono. A
 * transferência silencia a IA na conversa (`bot_silenced_until = infinity`): a conversa que a IA
 * atende, ou que está sem ninguém, fica como está (o novo dono a enxerga, por estar sem dono), para
 * a troca de responsável não desligar a IA por tabela.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/lib/api/handlers/types";
import { passarAConversa } from "@/lib/iavek/passar-a-conversa";

export const MOTIVO_DA_CONVERSA_COM_O_DONO = "Transferiu a conversa junto com o responsável do negócio";

/** A conversa segue o novo dono? Só se está com uma PESSOA, e outra. Regra pura. */
export function conversaSegue(assignedTo: string | null | undefined, novoDono: string): boolean {
  return Boolean(assignedTo) && assignedTo !== novoDono;
}

export async function conversaSegueODono(
  admin: SupabaseClient,
  args: { orgId: string; contactId: string | null; novoDono: string; actor: Actor },
): Promise<boolean> {
  if (!args.contactId) return false;
  // A MESMA conversa que `passarAConversa` escolhe: a mais recente, de pessoa, não arquivada.
  const { data } = await admin
    .from("conversations")
    .select("assigned_to_user_id")
    .eq("organization_id", args.orgId)
    .eq("contact_id", args.contactId)
    .eq("is_group", false)
    .neq("status", "archived")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!conversaSegue((data as { assigned_to_user_id: string | null } | null)?.assigned_to_user_id, args.novoDono)) return false;
  await passarAConversa(admin, {
    orgId: args.orgId,
    contactId: args.contactId,
    para: args.novoDono,
    actor: args.actor,
    motivo: MOTIVO_DA_CONVERSA_COM_O_DONO,
  });
  return true;
}
