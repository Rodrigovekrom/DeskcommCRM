/**
 * GET/POST /api/v1/conversations/[id]/orientar-ia — o canal de orientação da IA
 * (ia.vek v1.9.13). POST guarda a orientação e pede uma sugestão nova: quem envia
 * ao cliente continua sendo a aprovação do rascunho, com 1 clique.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { generateReplyDraft } from "@/lib/agent-engine/agent/reply-drafts";
import { motivoDaFalha } from "@/lib/agent-engine/agent/sugestao-de-resposta";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { traduzir } from "@/lib/i18n/dicionario";
import { canalDaIaAtivo, orientacaoSchema, podeOrientar } from "@/lib/iavek/canal-da-ia";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const db = await createClient();
  const orgId = authz.org.orgId;
  const [{ data: org }, { data: vinculo }] = await Promise.all([
    db.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    db.from("user_organizations").select("interface_settings").eq("organization_id", orgId).eq("user_id", authz.user.id).is("revoked_at", null).maybeSingle(),
  ]);
  const funcao = (vinculo?.interface_settings as { funcao?: unknown } | null)?.funcao;
  const pode = canalDaIaAtivo(org?.settings) && podeOrientar(authz.org.role, funcao);
  if (!pode) return ok({ pode: false, orientacoes: [] }, { requestId });
  const { data } = await db
    .from("iavek_orientacoes_da_ia")
    .select("id, texto, criada_em")
    .eq("organization_id", orgId)
    .eq("conversation_id", id)
    .order("criada_em", { ascending: false })
    .limit(5);
  return ok({ pode: true, orientacoes: data ?? [] }, { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  const corpo = orientacaoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Escreva a orientação (até 1000 caracteres)."), 422, { requestId });

  const db = await createClient();
  const orgId = authz.org.orgId;
  const { data: orientacaoId, error } = await db.rpc("fn_iavek_orientar_ia", {
    p_org: orgId,
    p_conversa: id,
    p_texto: corpo.data.texto,
  });
  if (error) {
    if (error.message.includes("canal_desligado"))
      return fail("canal_desligado", t("O canal de orientação da IA está desligado nesta empresa."), 409, { requestId });
    if (error.message.includes("orientacao_sem_permissao") || error.message.includes("caller_not_authorized_for_org"))
      return fail("forbidden_role", t("Só Suporte IA, gerente ou admin orientam a IA."), 403, { requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }
  void audit({
    action: "ai_orientation.created",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { orientacao_id: orientacaoId },
  });

  // A orientação já está guardada. Se a sugestão não sair, a recusa é sobre a
  // sugestão: o sino avisa o motivo (0601) e a tela diz o que houve.
  const { data: conversa } = await db
    .from("conversations")
    .select("contact_id, channel_session_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversa?.contact_id || !conversa.channel_session_id) {
    return ok({ orientacao_id: orientacaoId, sugestao: false, motivo: t("Conversa sem contato/canal.") }, { requestId });
  }
  try {
    const draft = await generateReplyDraft(getRequestPool(), requestTurnDeps(), {
      organizationId: orgId,
      conversationId: id,
      contactId: conversa.contact_id as string,
      channelId: conversa.channel_session_id as string,
    });
    return ok({ orientacao_id: orientacaoId, sugestao: true, draft_id: draft.id, status: draft.status }, { requestId });
  } catch (erro) {
    const motivo = motivoDaFalha(erro);
    logger.error("[orientar-ia] orientação guardada, sugestão não gerada", {
      requestId,
      organizationId: orgId,
      conversationId: id,
      motivo: motivo.codigo,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return ok({ orientacao_id: orientacaoId, sugestao: false, motivo: t(motivo.texto) }, { requestId });
  }
}
