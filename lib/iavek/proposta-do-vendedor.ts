/**
 * ia.vek v1.7.6 — a proposta do vendedor e a aprovação do gerente.
 *
 * Decisão do dono do produto (21/10/2026):
 *   · o vendedor (e o SDR) cria e prepara a proposta do PRÓPRIO lead — o lead
 *     em que ele é o dono (`crm_leads.owner_user_id`);
 *   · ela só vai ao cliente depois do OK do gerente ou do admin: o vendedor
 *     "pede aprovação", o gerente "aprova e envia" (o envio de sempre) ou
 *     "devolve" com motivo;
 *   · gerente e admin preparam e enviam direto, sem pedir a si mesmos.
 *
 * As regras puras ficam aqui (testáveis sem banco); o acesso ao banco é de
 * `exigirPropostaDoProprioLead`, que as rotas chamam depois do `requireRole`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { fail } from "@/lib/api/wrappers";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export const AGUARDANDO_APROVACAO = "aguardando_aprovacao" as const;

/** Gerente e admin aprovam (e preparam qualquer proposta). */
export function aprovaProposta(role: string | null | undefined): boolean {
  return roleAtLeast(role, "manager");
}

/** O vendedor só pede aprovação de um rascunho. */
export function podePedirAprovacao(status: string): boolean {
  return status === "rascunho";
}

/** "Aprovar e enviar": o rascunho (gerente enviando direto) ou o que aguarda. */
export function podeSerEnviada(status: string): boolean {
  return status === "rascunho" || status === AGUARDANDO_APROVACAO;
}

/** Devolver só o que está aguardando. */
export function podeSerDevolvida(status: string): boolean {
  return status === AGUARDANDO_APROVACAO;
}

/** O motivo da devolução: obrigatório, limpo, até 500 caracteres. */
export function motivoDaDevolucao(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.trim();
  return limpo.length >= 3 && limpo.length <= 500 ? limpo : null;
}

/**
 * Quem não é gerente/admin só mexe na proposta de um lead DELE. Devolve o 403
 * (ou 404) pronto, ou `null` para seguir. Usa o client que a rota passar —
 * service role ou sessão —, sempre filtrando a organização à mão.
 */
export async function exigirPropostaDoProprioLead(args: {
  db: SupabaseClient;
  orgId: string;
  propostaId: string;
  userId: string;
  role: string;
  requestId: string;
  idioma?: Idioma;
}): Promise<Response | null> {
  const { db, orgId, propostaId, userId, role, requestId, idioma } = args;
  if (aprovaProposta(role)) return null;
  const t = (s: string) => traduzir(s, idioma ?? "pt-BR");
  const { data: proposta, error } = await db
    .from("crm_proposals")
    .select("id, lead_id")
    .eq("organization_id", orgId)
    .eq("id", propostaId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!proposta) return fail("not_found", t("Proposta não encontrada."), 404, { requestId });
  return exigirLeadProprio({
    db,
    orgId,
    leadId: proposta.lead_id as string | null,
    userId,
    role,
    requestId,
    idioma,
  });
}

/** A mesma régua, a partir do lead (criar proposta para um lead). */
export async function exigirLeadProprio(args: {
  db: SupabaseClient;
  orgId: string;
  leadId: string | null;
  userId: string;
  role: string;
  requestId: string;
  idioma?: Idioma;
}): Promise<Response | null> {
  const { db, orgId, leadId, userId, role, requestId, idioma } = args;
  if (aprovaProposta(role)) return null;
  const t = (s: string) => traduzir(s, idioma ?? "pt-BR");
  const recusa = () =>
    fail("forbidden", t("Você só prepara proposta de lead seu. Peça ao gerente."), 403, {
      requestId,
    });
  if (!leadId) return recusa();
  const { data: lead, error } = await db
    .from("crm_leads")
    .select("owner_user_id")
    .eq("organization_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return lead?.owner_user_id === userId ? null : recusa();
}
