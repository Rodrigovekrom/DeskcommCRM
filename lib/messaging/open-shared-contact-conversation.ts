/**
 * Abre (ou reabre) a conversa 1:1 com um contato compartilhado no cartão do inbox.
 * Usa a mesma sessão de canal da mensagem onde o cartão apareceu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureConversation, sessaoProntaParaEnvio } from "@/lib/automation/start-conversation";
import { encontrarContatoPorTelefone } from "@/lib/channels/contato-por-telefone";
import { phoneLookupVariants, canonicalPhoneBR } from "@/lib/channels/phone-variants";
import { parseDialablePhone } from "@/lib/messaging/contact-card";

type Admin = SupabaseClient;

export interface OpenSharedContactInput {
  channel_session_id?: string;
  contact_id?: string;
  phone_number?: string;
  name?: string;
}

/**
 * v1.9.52.4 (Maestro 071802, Lupa 052500/052543/052617): quem ABRE pela tela. Só pessoa: a rota passa; a tool MCP e
 * os tokens de API não passam e seguem como antes.
 */
export interface ChamadorDaAbertura {
  userId: string;
  /** O cliente DO USUÁRIO (o token dele, com RLS). Nunca o admin. */
  supabase: SupabaseClient;
}

export interface OpenSharedContactResult {
  conversation_id: string;
  contact_id: string;
}

/**
 * Delega para `encontrarContatoPorTelefone` — ver o cabeçalho de
 * `escolherContatoCanonico`. Era cópia local com `.limit(1)` e sem `order by`.
 */
async function findContactByPhoneVariants(
  admin: Admin,
  orgId: string,
  rawPhone: string,
): Promise<{ id: string; phone_number: string } | null> {
  return encontrarContatoPorTelefone(admin as never, orgId, rawPhone);
}

/** ia.vek v1.9.19.1: o contato que esta abertura alcançaria, sem criar nada. */
export async function contatoExistenteDaAbertura(
  admin: Admin,
  orgId: string,
  input: OpenSharedContactInput,
): Promise<string | null> {
  if (input.contact_id) return input.contact_id;
  const phone = input.phone_number ? parseDialablePhone(input.phone_number) : null;
  if (!phone) return null;
  const existente = await findContactByPhoneVariants(admin, orgId, canonicalPhoneBR(phone));
  return existente?.id ?? null;
}

async function resolveContactId(
  admin: Admin,
  orgId: string,
  input: OpenSharedContactInput,
): Promise<string> {
  if (input.contact_id) {
    const { data, error } = await admin
      .from("contacts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", input.contact_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("contact_not_found");
    return (data as { id: string }).id;
  }

  const phone = input.phone_number ? parseDialablePhone(input.phone_number) : null;
  if (!phone) throw new Error("invalid_phone");
  const canonico = canonicalPhoneBR(phone);

  const existente = await findContactByPhoneVariants(admin, orgId, canonico);
  if (existente) return existente.id;

  const waid = canonico.replace(/\D/g, "");
  const { data: contactId, error: upsertErr } = await admin.rpc(
    "fn_upsert_wa_contact" as never,
    {
      p_org: orgId,
      p_kind: "phone",
      p_phone: canonico,
      p_lid: null,
      p_chat_id: waid,
      p_notify: input.name?.trim() || null,
    } as never,
  );
  if (upsertErr || !contactId) {
    throw new Error(upsertErr?.message ?? "contact_upsert_failed");
  }
  return contactId as string;
}

/** Garante contato + conversa na sessão indicada; reabre conversa fechada se existir. */
export async function openSharedContactConversation(
  admin: Admin,
  organizationId: string,
  input: OpenSharedContactInput,
  chamador?: ChamadorDaAbertura,
): Promise<OpenSharedContactResult> {
  const sessionId = input.channel_session_id ?? (await sessaoProntaParaEnvio(admin, organizationId));
  if (!sessionId) throw new Error("session_not_found");
  const { data: session, error: sessErr } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  if (sessErr) throw new Error(sessErr.message);
  if (!session) throw new Error("session_not_found");

  const contactId = await resolveContactId(admin, organizationId, input);
  // Abrir conversa com pessoal é escrita para fora da operação (spec 21, etapa
  // 12): o ponto único recusa — vale para a rota `open-with-contact` e para a
  // tool MCP, que passam por aqui. O `send` recusaria depois, mas a conversa
  // vazia já teria nascido.
  const { data: alvo, error: alvoErr } = await admin
    .from("contacts")
    .select("is_personal")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (alvoErr) throw new Error(alvoErr.message);
  if ((alvo as { is_personal?: boolean } | null)?.is_personal === true) {
    throw new Error("contact_personal");
  }
  const observada = chamador
    ? await conferirConversaDoChamador(admin, organizationId, contactId, sessionId, chamador)
    : undefined;
  let conversationId: string;
  try {
    conversationId = await ensureConversation(admin, organizationId, contactId, sessionId, observada);
  } catch (err) {
    // a conversa mudou entre a conferência e a abertura: recusa, em vez de abrir uma conversa não conferida
    if ((err as { code?: string } | null)?.code === "40001") throw new Error("conversation_stale");
    throw err;
  }
  return { conversation_id: conversationId, contact_id: contactId };
}

/**
 * v1.9.52.4: a conversa que o banco ESCOLHERIA (o mesmo filtro e a mesma ordem do fn_service_begin). Se ela tem dono,
 * o dono NÃO é o chamador e o chamador NÃO a vê pela RLS (o cliente dele), recusa: abrir reabriria a conversa de
 * outra pessoa e, ao reabrir, o banco zera o dono (fn_service_stamp_status), e ela sairia de quem a tinha.
 * Sem dono, do próprio chamador, ou de outro que ele vê (gerente, admin): segue como hoje. Devolve a fronteira
 * observada, que vai ao fn_service_begin como p_observed (se a conversa mudar no meio, service_stale).
 */
async function conferirConversaDoChamador(
  admin: Admin,
  organizationId: string,
  contactId: string,
  sessionId: string,
  chamador: ChamadorDaAbertura,
): Promise<Record<string, unknown>> {
  const { data: conversa, error } = await admin
    .from("conversations")
    .select("id, assigned_to_user_id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("is_group", false)
    .eq("channel_session_id", sessionId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const c = conversa as { id: string; assigned_to_user_id: string | null } | null;
  if (!c) return { organization_id: organizationId, contact_id: contactId, absent: true };
  const { data: fronteira, error: fErr } = await admin.rpc("fn_service_boundary", {
    p_org: organizationId,
    p_conversation: c.id,
  });
  if (fErr) throw new Error(fErr.message);
  if (c.assigned_to_user_id && c.assigned_to_user_id !== chamador.userId) {
    const { data: vista } = await chamador.supabase
      .from("conversations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", c.id)
      .maybeSingle();
    if (!vista) throw new Error("conversation_of_other");
  }
  return fronteira as Record<string, unknown>;
}
