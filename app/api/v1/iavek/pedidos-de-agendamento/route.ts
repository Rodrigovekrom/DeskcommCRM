/**
 * /api/v1/iavek/pedidos-de-agendamento — ia.vek v1.7.6.
 *
 * POST  agent+ (SDR, vendedor, suporte, gerente): pede um agendamento —
 *       `{ contact_id, lead_id?, conversation_id?, quando, event_type_id?, observacao? }`.
 *       Não reserva horário. Os admins são avisados no sino.
 *       ia.vek v1.9.3: com `vendedor_id`, o SDR DA LOJA marca direto — o
 *       compromisso nasce confirmado para o vendedor escolhido, sem o admin, e o
 *       vendedor é avisado no sino (`sdrMarcaDireto`). Quem não é SDR da loja e
 *       manda `vendedor_id` recebe 403: segue pedindo, como sempre.
 * GET   o admin vê os PENDENTES da organização (e os decididos nos últimos 30
 *       dias); os demais veem os PRÓPRIOS pedidos.
 *
 * Decidir (confirmar, recusar, cancelar) é `POST /pedidos-de-agendamento/[id]`.
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
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { traduzir } from "@/lib/i18n/dicionario";
import { avisarVendedorDoAgendamento } from "@/lib/iavek/avisos-da-proposta";
import {
  gravarPedidoDeAgendamento,
  pedidoDeAgendamentoSchema,
  type PedidoGravado,
} from "@/lib/iavek/pedidos-de-agendamento";
import { sdrMarcaDireto, vendedoresDaLoja } from "@/lib/iavek/sdr-marca-direto";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const DIA = 86_400_000;

const corpoSchema = pedidoDeAgendamentoSchema.extend({ vendedor_id: z.string().uuid().optional() });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const ehAdmin = roleAtLeast(authz.org.role, "admin");
  const supabase = await createClient();

  const desde = new Date(Date.now() - 30 * DIA).toISOString();
  let consulta = supabase
    .from("iavek_pedidos_de_agendamento")
    .select(
      "id, contact_id, lead_id, conversation_id, quando, event_type_id, observacao, origem, pedido_por, status, decidido_em, motivo_da_recusa, appointment_id, created_at, contacts(name, display_name, phone_number)",
    )
    .eq("organization_id", orgId)
    .or(`status.eq.pendente,created_at.gte.${desde}`)
    .order("quando", { ascending: true })
    .limit(200);
  if (!ehAdmin) consulta = consulta.eq("pedido_por", authz.user.id);
  const { data, error } = await consulta;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  type Linha = {
    pedido_por: string | null;
    contacts?: unknown;
  } & Record<string, unknown>;
  const linhas = (data ?? []) as unknown as Linha[];
  const nomes = await nomesDosAtendentes(
    linhas.map((l) => l.pedido_por).filter((u): u is string => Boolean(u)),
  );
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const pedidos = linhas.map(({ contacts, ...l }) => {
    const c = (Array.isArray(contacts) ? contacts[0] : contacts) as
      | { name?: string | null; display_name?: string | null; phone_number?: string | null }
      | null
      | undefined;
    return {
      ...l,
      contato_nome: c ? rotuloDoContato(c as never, t) : null,
      pedido_por_nome:
        l.origem === "ia" ? t("IA") : l.pedido_por ? (nomes.get(l.pedido_por) ?? null) : null,
    };
  });
  return ok({ pedidos, pode_decidir: ehAdmin }, { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const { vendedor_id: vendedorId, ...input } = parsed.data;
  if (vendedorId) return sdrMarca(authz, input, vendedorId, requestId);

  const r = await gravarPedidoDeAgendamento(createAdminClient(), {
    orgId: authz.org.orgId,
    input,
    origem: "pessoa",
    pedidoPor: authz.user.id,
  });
  if (!r.ok) {
    const code =
      r.status === 404 ? "not_found" : r.status === 422 ? "validation_failed" : "internal_error";
    return fail(code, t(r.motivo), r.status, { requestId });
  }
  void audit({
    action: "agenda.request_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "iavek_pedido_de_agendamento",
    resourceId: r.pedido.id,
    requestId,
  });
  return ok(r.pedido, { requestId, status: 201 });
}

type Autorizado = Extract<Awaited<ReturnType<typeof requireRole>>, { ok: true }>;

/**
 * ia.vek v1.9.3 — o SDR da loja MARCA para o vendedor escolhido. Grava o pedido
 * (o histórico do SDR e a meta seguem contando por ele) já como confirmado por
 * ele mesmo, cria o compromisso confirmado com o vendedor como responsável e
 * avisa o vendedor. Os admins não recebem pedido para confirmar.
 */
async function sdrMarca(
  authz: Autorizado,
  input: z.infer<typeof pedidoDeAgendamentoSchema>,
  vendedorId: string,
  requestId: string,
): Promise<Response> {
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  if (!(await sdrMarcaDireto(admin, orgId, authz.user.id))) {
    return fail("forbidden_role", t("Só o SDR da loja marca direto. Envie um pedido de agendamento."), 403, {
      requestId,
    });
  }
  if (!(await vendedoresDaLoja(admin, orgId)).some((v) => v.id === vendedorId)) {
    return fail("validation_failed", t("Escolha um vendedor da loja."), 422, { requestId });
  }
  const eventTypeId = input.event_type_id ?? (await tipoUnicoAtivo(admin, orgId));
  if (!eventTypeId) {
    return fail("validation_failed", t("Escolha o tipo de agendamento."), 422, { requestId });
  }

  const r = await gravarPedidoDeAgendamento(admin, {
    orgId,
    input: { ...input, event_type_id: eventTypeId },
    origem: "pessoa",
    pedidoPor: authz.user.id,
    avisarAdmins: false,
  });
  if (!r.ok) {
    const code = r.status === 404 ? "not_found" : r.status === 422 ? "validation_failed" : "internal_error";
    return fail(code, t(r.motivo), r.status, { requestId });
  }
  const pedido = r.pedido;
  // Se o compromisso não nascer, o pedido NÃO fica pendurado para o admin: o
  // SDR vê o erro na hora e marca de novo.
  const cancelarOPedido = () =>
    admin
      .from("iavek_pedidos_de_agendamento")
      .update({ status: "cancelado", updated_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", pedido.id);
  await admin
    .from("iavek_pedidos_de_agendamento")
    .update({ status: "confirmado", decidido_por: authz.user.id, decidido_em: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", pedido.id)
    .eq("status", "pendente");

  let compromisso: Record<string, unknown>;
  try {
    // Service role: a política da agenda só deixa o admin escrever na loja; a
    // autoridade do SDR foi conferida acima, no banco.
    compromisso = await marcarAgendamentoHandler(
      admin,
      {
        organization_id: orgId,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
        iavekSdrMarcaParaVendedor: true,
      },
      {
        event_type_id: eventTypeId,
        starts_at: new Date(pedido.quando).toISOString(),
        contact_id: pedido.contact_id,
        ...(pedido.conversation_id ? { conversation_id: pedido.conversation_id } : {}),
        owner_user_id: vendedorId,
        ...(pedido.observacao ? { description: pedido.observacao } : {}),
      },
    );
  } catch (erro) {
    await cancelarOPedido();
    if (erro instanceof ApiError) {
      return fail(erro.code, erro.message, erro.status, { requestId, details: erro.details as never });
    }
    throw erro;
  }
  const appointmentId = typeof compromisso.id === "string" ? compromisso.id : null;
  const { data: confirmado } = await admin
    .from("iavek_pedidos_de_agendamento")
    .update({ appointment_id: appointmentId, updated_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("id", pedido.id)
    .select("*")
    .maybeSingle();
  void audit({
    action: "agenda.sdr_booked_for_seller",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "calendar_appointment",
    resourceId: appointmentId ?? pedido.id,
    requestId,
    metadata: { pedido_id: pedido.id, vendedor_id: vendedorId },
  });
  await avisarVendedorDoAgendamento(admin, {
    orgId,
    vendedorId,
    atorId: authz.user.id,
    leadId: pedido.lead_id,
    appointmentId,
    quando: new Date(pedido.quando).toISOString(),
  });
  return ok({ pedido: (confirmado ?? pedido) as PedidoGravado, compromisso }, { requestId, status: 201 });
}

/** Sem tipo escolhido: o único tipo ativo da empresa, se houver um só. */
async function tipoUnicoAtivo(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(2);
  const [unico, outro] = data ?? [];
  return unico && !outro ? (unico.id as string) : null;
}
