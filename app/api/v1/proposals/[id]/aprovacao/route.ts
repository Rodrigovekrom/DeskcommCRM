/**
 * POST /api/v1/proposals/[id]/aprovacao — ia.vek v1.7.6.
 *
 *   { "acao": "pedir" }                     vendedor/SDR, só no PRÓPRIO lead:
 *                                           rascunho → aguardando_aprovacao.
 *   { "acao": "devolver", "motivo": "..." } gerente/admin: aguardando_aprovacao
 *                                           → rascunho, com o motivo visível.
 *
 * "Aprovar" é o envio de sempre (`POST /proposals/[id]/send`, gerente+), que
 * aceita a proposta aguardando. As transições são do servidor (service role,
 * como o envio), com `organization_id` filtrado à mão e a troca de status
 * condicionada ao status lido (duas pessoas clicando não fazem dois efeitos).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  avisarGestoresDaAprovacao,
  avisarQuemPediuAprovacao,
} from "@/lib/iavek/avisos-da-proposta";
import {
  AGUARDANDO_APROVACAO,
  aprovaProposta,
  exigirPropostaDoProprioLead,
  motivoDaDevolucao,
  podePedirAprovacao,
  podeSerDevolvida,
} from "@/lib/iavek/proposta-do-vendedor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { sePropostasDesligadas } from "@/lib/propostas/porta";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("pedir") }).strict(),
  z.object({ acao: z.literal("devolver"), motivo: z.string() }).strict(),
]);

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_proposals" });
  if (!authz.ok) return authz.response;
  const desligada = await sePropostasDesligadas(authz.org.orgId, requestId);
  if (desligada) return desligada;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) {
    return fail("not_found", t("Proposta não encontrada."), 404, { requestId });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const corpo = parsed.data;
  const orgId = authz.org.orgId;
  const admin = createAdminClient();

  const { data: proposta } = await admin
    .from("crm_proposals")
    .select("id, lead_id, status, template_slug, aprovacao_pedida_por")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!proposta) return fail("not_found", t("Proposta não encontrada."), 404, { requestId });

  if (corpo.acao === "pedir") {
    const doLeadProprio = await exigirPropostaDoProprioLead({
      db: admin,
      orgId,
      propostaId: id,
      userId: authz.user.id,
      role: authz.org.role,
      requestId,
      idioma: authz.user.idioma,
    });
    if (doLeadProprio) return doLeadProprio;
    if (!podePedirAprovacao(String(proposta.status))) {
      return fail("proposal_context_stale", t("Só um rascunho pode ir para aprovação."), 409, {
        requestId,
      });
    }
    // O gerente não deve receber para aprovar algo que o envio recusaria.
    if (!proposta.template_slug) {
      return fail(
        "validation_failed",
        t("Escolha e confirme o modelo da proposta antes de pedir aprovação."),
        422,
        {
          requestId,
        },
      );
    }
    const { count } = await admin
      .from("crm_proposal_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("proposal_id", id);
    if (!count)
      return fail("validation_failed", t("A proposta não tem itens."), 422, { requestId });

    const { data: atualizada } = await admin
      .from("crm_proposals")
      .update({
        status: AGUARDANDO_APROVACAO,
        aprovacao_pedida_em: new Date().toISOString(),
        aprovacao_pedida_por: authz.user.id,
        devolucao_motivo: null,
      })
      .eq("organization_id", orgId)
      .eq("id", id)
      .eq("status", "rascunho")
      .select("*")
      .maybeSingle();
    if (!atualizada) {
      return fail("proposal_context_stale", t("A proposta mudou. Recarregue."), 409, { requestId });
    }
    void audit({
      action: "proposal.approval_requested",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "crm_proposal",
      resourceId: id,
      requestId,
    });
    await avisarGestoresDaAprovacao(admin, { orgId, proposta: atualizada, atorId: authz.user.id });
    return ok(atualizada, { requestId });
  }

  // devolver
  if (!aprovaProposta(authz.org.role)) {
    return fail("forbidden_role", t("Só o gerente ou o admin devolve uma proposta."), 403, {
      requestId,
    });
  }
  const motivo = motivoDaDevolucao(corpo.motivo);
  if (!motivo) {
    return fail(
      "validation_failed",
      t("Escreva o motivo da devolução (de 3 a 500 caracteres)."),
      422,
      {
        requestId,
      },
    );
  }
  if (!podeSerDevolvida(String(proposta.status))) {
    return fail("proposal_context_stale", t("Esta proposta não está aguardando aprovação."), 409, {
      requestId,
    });
  }
  const { data: devolvida } = await admin
    .from("crm_proposals")
    .update({
      status: "rascunho",
      devolvida_em: new Date().toISOString(),
      devolvida_por: authz.user.id,
      devolucao_motivo: motivo,
    })
    .eq("organization_id", orgId)
    .eq("id", id)
    .eq("status", AGUARDANDO_APROVACAO)
    .select("*")
    .maybeSingle();
  if (!devolvida)
    return fail("proposal_context_stale", t("A proposta mudou. Recarregue."), 409, { requestId });
  void audit({
    action: "proposal.approval_returned",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_proposal",
    resourceId: id,
    requestId,
    metadata: { motivo },
  });
  await avisarQuemPediuAprovacao(admin, {
    orgId,
    proposta: devolvida,
    atorId: authz.user.id,
    tipo: "proposta_devolvida",
    motivo,
  });
  return ok(devolvida, { requestId });
}
