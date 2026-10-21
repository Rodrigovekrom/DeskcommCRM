/**
 * POST /api/v1/iavek/pedidos-de-agendamento/[id] — ia.vek v1.7.6.
 *
 *   { "acao": "confirmar", event_type_id?, starts_at?, owner_user_id? }
 *       ADMIN. Cria o compromisso com os dados do pedido (o admin pode trocar o
 *       horário — "remarcar" — e escolher o tipo e o responsável). Um clique,
 *       sem redigitar: o que faltar vem do pedido.
 *   { "acao": "recusar", "motivo": "..." }   ADMIN, com motivo.
 *   { "acao": "cancelar" }                    quem pediu, enquanto pendente.
 *
 * O pedido é marcado ANTES de criar o compromisso (troca de status condicionada
 * a 'pendente'): dois cliques não criam dois compromissos. Se a criação falhar,
 * o pedido volta a pendente.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { marcarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { avisarSobrePedidoDeAgendamento } from "@/lib/iavek/avisos-da-proposta";
import { podeDecidir, type PedidoGravado } from "@/lib/iavek/pedidos-de-agendamento";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion("acao", [
  z
    .object({
      acao: z.literal("confirmar"),
      event_type_id: z.string().uuid().optional(),
      starts_at: z.string().datetime({ offset: true }).optional(),
      owner_user_id: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ acao: z.literal("recusar"), motivo: z.string().trim().min(3).max(500) }).strict(),
  z.object({ acao: z.literal("cancelar") }).strict(),
]);

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success)
    return fail("not_found", t("Pedido não encontrado."), 404, { requestId });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const corpo = parsed.data;
  const orgId = authz.org.orgId;
  const ehAdmin = roleAtLeast(authz.org.role, "admin");
  const admin = createAdminClient();

  const { data: lido } = await admin
    .from("iavek_pedidos_de_agendamento")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (!lido) return fail("not_found", t("Pedido não encontrado."), 404, { requestId });
  const pedido = lido as PedidoGravado;
  if (!podeDecidir(pedido.status)) {
    return fail("conflict", t("Este pedido já foi decidido."), 409, { requestId });
  }

  const marcar = (patch: Record<string, unknown>) =>
    admin
      .from("iavek_pedidos_de_agendamento")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", id)
      .eq("status", "pendente")
      .select("*")
      .maybeSingle();

  if (corpo.acao === "cancelar") {
    if (pedido.pedido_por !== authz.user.id && !ehAdmin) {
      return fail("forbidden", t("Só quem pediu cancela o pedido."), 403, { requestId });
    }
    const { data } = await marcar({
      status: "cancelado",
      decidido_por: authz.user.id,
      decidido_em: new Date().toISOString(),
    });
    if (!data) return fail("conflict", t("Este pedido já foi decidido."), 409, { requestId });
    void audit({
      action: "agenda.request_cancelled",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "iavek_pedido_de_agendamento",
      resourceId: id,
      requestId,
    });
    return ok(data, { requestId });
  }

  if (!ehAdmin) {
    return fail(
      "forbidden_role",
      t("Só o administrador confirma ou recusa pedidos de agendamento."),
      403,
      {
        requestId,
      },
    );
  }

  if (corpo.acao === "recusar") {
    const { data } = await marcar({
      status: "recusado",
      decidido_por: authz.user.id,
      decidido_em: new Date().toISOString(),
      motivo_da_recusa: corpo.motivo,
    });
    if (!data) return fail("conflict", t("Este pedido já foi decidido."), 409, { requestId });
    void audit({
      action: "agenda.request_refused",
      actorUserId: authz.user.id,
      organizationId: orgId,
      resourceType: "iavek_pedido_de_agendamento",
      resourceId: id,
      requestId,
      metadata: { motivo: corpo.motivo },
    });
    await avisarSobrePedidoDeAgendamento(admin, {
      orgId,
      destinos: pedido.pedido_por ? [pedido.pedido_por] : [],
      tipo: "pedido_de_agendamento_recusado",
      leadId: pedido.lead_id,
      atorId: authz.user.id,
      pedidoId: id,
      quando: pedido.quando,
      motivo: corpo.motivo,
    });
    return ok(data, { requestId });
  }

  // confirmar
  const eventTypeId = corpo.event_type_id ?? pedido.event_type_id;
  if (!eventTypeId) {
    return fail("validation_failed", t("Escolha o tipo de agendamento para confirmar."), 422, {
      requestId,
    });
  }
  const inicio = corpo.starts_at ?? pedido.quando;
  const { data: reservado } = await marcar({
    status: "confirmado",
    decidido_por: authz.user.id,
    decidido_em: new Date().toISOString(),
  });
  if (!reservado) return fail("conflict", t("Este pedido já foi decidido."), 409, { requestId });

  let compromisso: Record<string, unknown>;
  try {
    compromisso = await marcarAgendamentoHandler(
      await createClient(),
      { organization_id: orgId, actor: { type: "user", id: authz.user.id }, requestId },
      {
        event_type_id: eventTypeId,
        starts_at: new Date(inicio).toISOString(),
        contact_id: pedido.contact_id,
        ...(pedido.conversation_id ? { conversation_id: pedido.conversation_id } : {}),
        ...(corpo.owner_user_id ? { owner_user_id: corpo.owner_user_id } : {}),
        ...(pedido.observacao ? { description: pedido.observacao } : {}),
      },
    );
  } catch (erro) {
    // A criação falhou: o pedido volta a pendente para o admin tentar de novo.
    await admin
      .from("iavek_pedidos_de_agendamento")
      .update({
        status: "pendente",
        decidido_por: null,
        decidido_em: null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", id)
      .eq("status", "confirmado")
      .is("appointment_id", null);
    if (erro instanceof ApiError) {
      return fail(erro.code, erro.message, erro.status, {
        requestId,
        details: erro.details as never,
      });
    }
    throw erro;
  }

  const appointmentId = typeof compromisso.id === "string" ? compromisso.id : null;
  const { data: confirmado } = await admin
    .from("iavek_pedidos_de_agendamento")
    .update({ appointment_id: appointmentId, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  void audit({
    action: "agenda.request_confirmed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "iavek_pedido_de_agendamento",
    resourceId: id,
    requestId,
    metadata: { appointment_id: appointmentId, remarcado: Boolean(corpo.starts_at) },
  });
  await avisarSobrePedidoDeAgendamento(admin, {
    orgId,
    destinos: pedido.pedido_por ? [pedido.pedido_por] : [],
    tipo: "pedido_de_agendamento_confirmado",
    leadId: pedido.lead_id,
    atorId: authz.user.id,
    pedidoId: id,
    quando: new Date(inicio).toISOString(),
  });
  return ok({ pedido: confirmado, compromisso }, { requestId });
}
