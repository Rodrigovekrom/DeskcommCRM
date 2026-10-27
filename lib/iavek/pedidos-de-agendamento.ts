/**
 * ia.vek v1.7.6 — o PEDIDO DE AGENDAMENTO.
 *
 * Decisão do dono do produto (21/10/2026): o SDR (e a IA) NÃO marcam direto.
 * Eles repassam cliente, dia e hora desejados e uma observação; o ADMIN
 * confirma com um clique (vira compromisso), remarca (confirma em outro
 * horário) ou recusa com motivo. O pedido NÃO reserva nem bloqueia horário.
 *
 * Tabela `iavek_pedidos_de_agendamento` (migration 0583): leitura para os
 * membros, escrita só do servidor. Este módulo tem as regras puras e a
 * gravação (service role, sempre filtrando a organização à mão).
 *
 * FUTURO (preparado, não ligado): a IA agendar sozinha é trocar o destino do
 * `crm_book_appointment` de "cria pedido" para "marca" — ver
 * `IA_AGENDA_SOZINHA` em lib/mcp/tools/agendamento.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { avisarSobrePedidoDeAgendamento, membrosComPapel } from "@/lib/iavek/avisos-da-proposta";

export const PEDIDO_MAX_DIAS = 180;

export const pedidoDeAgendamentoSchema = z
  .object({
    contact_id: z.string().uuid(),
    lead_id: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    quando: z.string().datetime({ offset: true }),
    event_type_id: z.string().uuid().optional(),
    observacao: z.string().trim().max(1000).optional(),
  })
  .strict();
export type PedidoDeAgendamentoInput = z.infer<typeof pedidoDeAgendamentoSchema>;

/** "Dia e hora desejados" precisa estar no futuro e a no máximo 180 dias. */
export function quandoValido(quando: string, agora = Date.now()): boolean {
  const t = new Date(quando).getTime();
  return Number.isFinite(t) && t > agora && t <= agora + PEDIDO_MAX_DIAS * 86_400_000;
}

export type StatusDoPedido = "pendente" | "confirmado" | "recusado" | "cancelado";

/** Só o pendente se decide (confirma, recusa ou cancela). */
export function podeDecidir(status: string): boolean {
  return status === "pendente";
}

export interface PedidoGravado {
  id: string;
  organization_id: string;
  contact_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  quando: string;
  event_type_id: string | null;
  observacao: string | null;
  origem: "pessoa" | "ia";
  pedido_por: string | null;
  status: StatusDoPedido;
}

/**
 * Grava o pedido e avisa os admins no sino. Confere que contato (e lead e
 * conversa, quando vierem) são DESTA organização — o corpo nunca é confiado.
 */
export async function gravarPedidoDeAgendamento(
  admin: SupabaseClient,
  args: {
    orgId: string;
    input: PedidoDeAgendamentoInput;
    origem: "pessoa" | "ia";
    pedidoPor: string | null;
    pedidoPorAgente?: string | null;
    /** v1.9.3: o SDR que marca direto não manda pedido para os admins. */
    avisarAdmins?: boolean;
  },
): Promise<{ ok: true; pedido: PedidoGravado } | { ok: false; status: number; motivo: string }> {
  const { orgId, input } = args;
  if (!quandoValido(input.quando)) {
    return {
      ok: false,
      status: 422,
      motivo: "O dia e a hora precisam estar no futuro, em até 180 dias.",
    };
  }
  const { data: contato } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", input.contact_id)
    .maybeSingle();
  if (!contato) return { ok: false, status: 404, motivo: "Contato não encontrado." };
  if (input.lead_id) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", input.lead_id)
      .eq("contact_id", input.contact_id)
      .maybeSingle();
    if (!lead)
      return { ok: false, status: 404, motivo: "Negócio não encontrado para este contato." };
  }
  if (input.conversation_id) {
    const { data: conversa } = await admin
      .from("conversations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", input.conversation_id)
      .eq("contact_id", input.contact_id)
      .maybeSingle();
    if (!conversa)
      return { ok: false, status: 404, motivo: "Conversa não encontrada para este contato." };
  }
  if (input.event_type_id) {
    const { data: tipo } = await admin
      .from("calendar_event_types")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", input.event_type_id)
      .maybeSingle();
    if (!tipo) return { ok: false, status: 404, motivo: "Tipo de agendamento não encontrado." };
  }

  const { data: pedido, error } = await admin
    .from("iavek_pedidos_de_agendamento")
    .insert({
      organization_id: orgId,
      contact_id: input.contact_id,
      lead_id: input.lead_id ?? null,
      conversation_id: input.conversation_id ?? null,
      quando: new Date(input.quando).toISOString(),
      event_type_id: input.event_type_id ?? null,
      observacao: input.observacao?.length ? input.observacao : null,
      origem: args.origem,
      pedido_por: args.pedidoPor,
      pedido_por_agente: args.pedidoPorAgente ?? null,
    })
    .select("*")
    .single();
  if (error || !pedido)
    return { ok: false, status: 500, motivo: error?.message ?? "Falha ao gravar o pedido." };

  if (args.avisarAdmins === false) return { ok: true, pedido: pedido as PedidoGravado };
  const admins = await membrosComPapel(admin, orgId, ["admin"]);
  await avisarSobrePedidoDeAgendamento(admin, {
    orgId,
    destinos: admins,
    tipo: "pedido_de_agendamento",
    leadId: (pedido as PedidoGravado).lead_id,
    atorId: args.pedidoPor,
    pedidoId: (pedido as PedidoGravado).id,
    quando: (pedido as PedidoGravado).quando,
  });
  return { ok: true, pedido: pedido as PedidoGravado };
}
