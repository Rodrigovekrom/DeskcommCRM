/**
 * Adaptador da confirmação pelo WhatsApp (ia.vek v1.9.2) para o dispatcher do
 * event_log. Consome `appointment.confirmed`; só age no modo agendamento.
 * Manda mensagem ao cliente: em organização parada, pula.
 */
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { confirmarPeloWhatsApp } from "@/workers/iavek-confirmacao-da-agenda";

export const IAVEK_CONFIRMACAO_HANDLER_KEY = "iavek-confirmacao-da-agenda.v1";

export const iavekConfirmacaoDaAgendaHandler: EventHandler = {
  key: IAVEK_CONFIRMACAO_HANDLER_KEY,
  naOrgParada: "pula",
  events: ["appointment.confirmed"],
  async handle(row): Promise<HandlerResult> {
    const r = await confirmarPeloWhatsApp(row as never);
    if (r.status === "ok") return { consumer_key: IAVEK_CONFIRMACAO_HANDLER_KEY, status: "ok", detail: r.detail };
    if (r.status === "skipped") return { consumer_key: IAVEK_CONFIRMACAO_HANDLER_KEY, status: "skipped", detail: r.reason };
    return { consumer_key: IAVEK_CONFIRMACAO_HANDLER_KEY, status: "error", detail: r.reason };
  },
};
