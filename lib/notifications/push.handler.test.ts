import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "./push_payload";

// `state.vapidPronto` é mutável de propósito: os testes de grupo abaixo
// precisam de VAPID "pronto" (senão o handler nem chega na ramificação), e o
// teste original precisa dele "ausente" — um só `vi.mock` por módulo por
// arquivo, então a alternância é por flag, não por uma segunda chamada.
const state = { vapidPronto: false };
vi.mock("@/lib/notifications/vapid", () => ({
  vapidPronto: () => state.vapidPronto,
}));

const enviarPushDaOrgMock = vi.fn(async (_organizationId: string, _payload: PushPayload) => ({ sent: 1, gone: 0 }));
const enviarPushAosUsuariosMock = vi.fn(
  async (_organizationId: string, _userIds: readonly string[], _payload: PushPayload) => ({ sent: 1, gone: 0 }),
);
const inscritosQueVeemMock = vi.fn(async (_pool: unknown, _org: string, _tabela: string, _id: string) => ["u-ve"]);
vi.mock("./quem-ve", () => ({
  inscritosQueVeem: (pool: unknown, org: string, tabela: string, id: string) => inscritosQueVeemMock(pool, org, tabela, id),
  gerenciaInscrita: async () => ["u-gerente"],
}));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
const enviarPushAoUsuarioMock = vi.fn(
  async (_organizationId: string, _userId: string | null, _payload: PushPayload) => ({ sent: 0, gone: 0 }),
);
vi.mock("./web_push", () => ({
  // Referências indiretas de propósito: o factory do `vi.mock` é hoisted
  // acima das declarações `const` deste arquivo, então gravar o mock
  // diretamente como valor (`enviarPushDaOrg: enviarPushDaOrgMock`) estoura
  // "Cannot access before initialization". Fechos lazy (chamados só quando o
  // handler de fato invoca) resolvem — mesmo padrão de
  // `tests/unit/media-persist-worker.test.ts`.
  enviarPushDaOrg: (organizationId: string, payload: PushPayload) => enviarPushDaOrgMock(organizationId, payload),
  enviarPushAoUsuario: (organizationId: string, userId: string | null, payload: PushPayload) =>
    enviarPushAoUsuarioMock(organizationId, userId, payload),
  enviarPushAosUsuarios: (organizationId: string, userIds: readonly string[], payload: PushPayload) =>
    enviarPushAosUsuariosMock(organizationId, userIds, payload),
}));

// A rota 1:1 (`handleInbound`) usa o admin client para buscar nome/avatar em
// `contacts`. A rota de grupo NUNCA deveria — é exatamente o que os testes
// abaixo travam. O client em si a rota de grupo pede (a régua do canal
// desativado, #2329, lê `channel_sessions`), então a trava é `from("contacts")`,
// não `createAdminClient`.
const fromMock = vi.fn();
const createAdminClientMock = vi.fn(() => ({ from: fromMock }) as unknown);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClientMock(),
}));

import { webPushInboundHandler } from "./push.handler";

function grupoRow(payload: Record<string, unknown> = {}) {
  return {
    id: "e-grupo",
    organization_id: "org1",
    event_type: "message.group_received",
    entity_kind: "message",
    entity_id: "m-grupo",
    payload: { conversation_id: "conv-1", contact_id: "contato-placeholder-grupo", body_preview: "bom dia, grupo", type: "text", ...payload },
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

describe("webPushInboundHandler", () => {
  beforeEach(() => {
    state.vapidPronto = false;
    enviarPushDaOrgMock.mockClear();
    enviarPushAoUsuarioMock.mockClear();
    enviarPushAosUsuariosMock.mockClear();
    inscritosQueVeemMock.mockClear();
    createAdminClientMock.mockClear();
    fromMock.mockClear();
  });

  it("pula quando VAPID não está configurado", async () => {
    const result = await webPushInboundHandler.handle({
      id: "e1",
      organization_id: "org",
      event_type: "message.received",
      entity_kind: "message",
      entity_id: "m1",
      payload: { conversation_id: "c1", body_preview: "oi", type: "text" },
      metadata: {},
      consumed_by: [],
      attempts: 0,
    });
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("vapid_ausente");
  });

  describe("grupo (message.group_received) — nunca a cópia do 1:1", () => {
    beforeEach(() => {
      state.vapidPronto = true;
    });

    it("título é a cópia de grupo, href aponta pra conversa, e vai SÓ a quem VÊ a conversa (CRM-530), nunca à org inteira", async () => {
      const result = await webPushInboundHandler.handle(grupoRow());

      expect(result.status).toBe("ok");
      expect(inscritosQueVeemMock).toHaveBeenCalledWith(expect.anything(), "org1", "conversations", "conv-1");
      expect(enviarPushAosUsuariosMock).toHaveBeenCalledTimes(1);
      const [orgId, destinos, payload] = enviarPushAosUsuariosMock.mock.calls[0]!;
      expect(orgId).toBe("org1");
      expect(destinos).toEqual(["u-ve"]);
      expect(payload).toMatchObject({ title: "Nova mensagem no grupo", href: "/app/inbox?id=conv-1" });
      // de fábrica ('so_nome'), o texto do grupo NÃO vai à tela de bloqueio
      expect(payload.body).toBe("Toque para abrir a conversa");
      expect(payload.title).not.toBe("Nova mensagem");
      // CRM-530: nunca mais a org inteira
      expect(enviarPushDaOrgMock).not.toHaveBeenCalled();
    });

    it("não busca nome/avatar do contato — `contacts` nunca é lido", async () => {
      await webPushInboundHandler.handle(grupoRow());
      expect(fromMock).not.toHaveBeenCalledWith("contacts");
    });

    it("sem conversation_id: não manda nada (não há conversa para conferir quem vê)", async () => {
      const r = await webPushInboundHandler.handle(grupoRow({ conversation_id: undefined }));
      expect(r.status).toBe("skipped");
      expect(r.detail).toBe("sem_conversa");
      expect(enviarPushAosUsuariosMock).not.toHaveBeenCalled();
    });
  });
});
