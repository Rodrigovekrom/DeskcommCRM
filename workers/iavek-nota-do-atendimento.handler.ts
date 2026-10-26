/**
 * Adaptador do avaliador do atendimento (ia.vek v1.8.4) para o dispatcher do
 * event_log. Único consumidor de `conversation.closed`, que só é emitido com a
 * chave da loja ligada. Custa dinheiro de provedor: em organização parada, pula.
 */
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { avaliarAtendimento } from "@/workers/iavek-nota-do-atendimento";

export const IAVEK_NOTA_HANDLER_KEY = "iavek-nota-do-atendimento.v1";

export const iavekNotaDoAtendimentoHandler: EventHandler = {
  key: IAVEK_NOTA_HANDLER_KEY,
  naOrgParada: "pula",
  events: ["conversation.closed"],
  async handle(row): Promise<HandlerResult> {
    const r = await avaliarAtendimento(row);
    if (r.status === "ok") return { consumer_key: IAVEK_NOTA_HANDLER_KEY, status: "ok", detail: `nota ${r.nota}` };
    if (r.status === "skipped") return { consumer_key: IAVEK_NOTA_HANDLER_KEY, status: "skipped", detail: r.reason };
    return { consumer_key: IAVEK_NOTA_HANDLER_KEY, status: "error", detail: r.reason };
  },
};
