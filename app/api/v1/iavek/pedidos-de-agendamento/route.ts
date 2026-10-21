/**
 * /api/v1/iavek/pedidos-de-agendamento — ia.vek v1.7.6.
 *
 * POST  agent+ (SDR, vendedor, suporte, gerente): pede um agendamento —
 *       `{ contact_id, lead_id?, conversation_id?, quando, event_type_id?, observacao? }`.
 *       Não reserva horário. Os admins são avisados no sino.
 * GET   o admin vê os PENDENTES da organização (e os decididos nos últimos 30
 *       dias); os demais veem os PRÓPRIOS pedidos.
 *
 * Decidir (confirmar, recusar, cancelar) é `POST /pedidos-de-agendamento/[id]`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { traduzir } from "@/lib/i18n/dicionario";
import {
  gravarPedidoDeAgendamento,
  pedidoDeAgendamentoSchema,
} from "@/lib/iavek/pedidos-de-agendamento";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const DIA = 86_400_000;

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

  const parsed = pedidoDeAgendamentoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Campos inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const r = await gravarPedidoDeAgendamento(createAdminClient(), {
    orgId: authz.org.orgId,
    input: parsed.data,
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
