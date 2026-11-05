import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { webPushInboundHandler } from "@/lib/notifications/push.handler";
import { ensureHandlersRegistered } from "@/lib/event-log/register-handlers";
import { AVISO_DE_AJUDA_KEY } from "@/lib/iavek/aviso-de-ajuda.handler";

describe("grupos: quem escuta e quem não escuta", () => {
  it("a notificação do atendente escuta mensagem de grupo", () => {
    expect(webPushInboundHandler.events).toContain("message.group_received");
  });

  it("nenhum outro consumidor registrado escuta message.group_received", async () => {
    const { getRegisteredHandlers } = await import("@/lib/event-log/dispatcher");
    ensureHandlersRegistered();
    const escutam = getRegisteredHandlers()
      .filter((h) => h.events.includes("message.group_received"))
      .map((h) => h.key);
    // ia.vek v1.9.22: o aviso do Venda.IA no grupo da equipe (Guardião Leads). Ele só age no grupo
    // e no número gravados em settings.iavek.guardiao_leads; sem isso pula ("sem_configuracao").
    expect(escutam.sort()).toEqual([AVISO_DE_AJUDA_KEY, webPushInboundHandler.key].sort());
  });

  it("listagem de contatos e audiência de campanha excluem o contato de grupo", () => {
    for (const arquivo of ["app/api/v1/contacts/_handler.ts", "lib/campanhas/consulta-de-audiencia.ts"]) {
      expect(readFileSync(arquivo, "utf8"), arquivo).toMatch(/\.eq\(\s*["']kind["']\s*,\s*["']person["']\s*\)/);
    }
  });
});
