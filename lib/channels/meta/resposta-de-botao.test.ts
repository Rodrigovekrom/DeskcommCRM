import { describe, expect, it } from "vitest";
import { parseMetaWebhook } from "./webhook";
import type { MetaWebhookEnvelope } from "./envelope";

// Payloads no formato dos webhooks da WhatsApp Cloud API.
function envelope(mensagem: Record<string, unknown>): MetaWebhookEnvelope {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "551530000000", phone_number_id: "PN1" },
              contacts: [{ profile: { name: "Juliana" }, wa_id: "5515999990000" }],
              messages: [{ from: "5515999990000", id: "wamid.X", timestamp: "1760620000", ...mensagem }],
            },
          },
        ],
      },
    ],
  } as unknown as MetaWebhookEnvelope;
}

describe("resposta de botão da API oficial (CRM-136)", () => {
  it("botão de TEMPLATE vira texto com o rótulo e guarda o payload", () => {
    const [e] = parseMetaWebhook(envelope({ type: "button", button: { text: "Quero agendar", payload: "AGENDAR" } }));
    expect(e).toMatchObject({
      kind: "inbound_message",
      type: "text",
      text: "Quero agendar",
      botao: { payload: "AGENDAR", origem: "template" },
    });
  });
  it("botão e lista INTERATIVOS viram texto com o título", () => {
    const [b] = parseMetaWebhook(
      envelope({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "sim", title: "Sim, pode ser" } } }),
    );
    expect(b).toMatchObject({ type: "text", text: "Sim, pode ser", botao: { payload: "sim", origem: "interativo" } });
    const [l] = parseMetaWebhook(
      envelope({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "sab", title: "Sábado 9h30" } } }),
    );
    expect(l).toMatchObject({ type: "text", text: "Sábado 9h30" });
  });
  it("texto comum segue igual e não ganha `botao`", () => {
    const [t] = parseMetaWebhook(envelope({ type: "text", text: { body: "oi" } }));
    expect(t).toMatchObject({ type: "text", text: "oi" });
    expect((t as { botao?: unknown }).botao).toBeUndefined();
  });
});
