/**
 * ia.vek v1.9.64 (o achado da Lupa 1232): o `webpush.setVapidDetails` ficava FORA do try em web_push.ts. Com o subject
 * inválido (ex.: sem SUPPORT_EMAIL e o NEXT_PUBLIC_APP_URL em http:, o caso medido no canário da 61) ou uma chave
 * recusada, o throw subia: 500 na rota "Enviar um teste" e erro (com re-tentativa) no drain. Agora é a falha LIMPA:
 *   - o envio devolve { sent: 0, gone: 0, falha: "vapid_invalido" }, sem tocar em nenhum aparelho;
 *   - o log leva SÓ o motivo fixo (a mensagem do web-push repete o subject, o e-mail de suporte);
 *   - o handler devolve 'skipped' / 'vapid_invalido';
 *   - a rota de teste devolve 503 'unavailable', nunca 500.
 * O setVapidDetails aqui é o VERDADEIRO do web-push (só o sendNotification é falso): a validação é a dele.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type WebPushReal = typeof import("web-push");

async function webPushComEnvioFalso() {
  const real = (await vi.importActual<{ default: WebPushReal }>("web-push")).default;
  const enviar = vi.fn(async () => ({ statusCode: 201 }));
  vi.doMock("web-push", () => ({
    default: { setVapidDetails: real.setVapidDetails.bind(real), sendNotification: enviar },
  }));
  return { real, enviar };
}

async function webPushCom(cfg: { suporte: string; appUrl: string; publica?: string }) {
  const { real, enviar } = await webPushComEnvioFalso();
  const par = real.generateVAPIDKeys();
  const env = {
    VAPID_PUBLIC_KEY: cfg.publica ?? par.publicKey,
    VAPID_PRIVATE_KEY: par.privateKey,
    NEXT_PUBLIC_APP_URL: cfg.appUrl,
  };
  vi.doMock("@/lib/env", () => ({ env }));
  vi.doMock("@/lib/instalacao/config", () => ({ valorDaInstalacao: async () => ({ valor: cfg.suporte }) }));
  const avisos: { evento: string; dados: unknown }[] = [];
  vi.doMock("@/lib/logger", () => ({
    logger: { warn: (evento: string, dados: unknown) => avisos.push({ evento, dados }), info: () => {}, error: () => {} },
  }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
  const apagar = vi.fn(async () => ({ error: null }));
  const admin = {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ id: "s1", endpoint: "https://127.0.0.1:9/x", p256dh: "p", auth: "a" }], error: null }),
      }),
      delete: () => ({ eq: apagar }),
    }),
  };
  const mod = await import("@/lib/notifications/web_push");
  return { mod, admin, enviar, avisos, apagar };
}

const PAYLOAD = { title: "t", body: "b", tag: "x", href: "/app" };

describe("v1.9.64: o VAPID mal configurado falha LIMPO no envio (o setVapidDetails verdadeiro)", () => {
  beforeEach(() => vi.resetModules());

  it("sem SUPPORT_EMAIL e o APP_URL em http: (o caso do canário): falha 'vapid_invalido', nenhum aparelho tocado", async () => {
    const { mod, admin, enviar, avisos, apagar } = await webPushCom({ suporte: "", appUrl: "http://localhost:3901" });
    const r = await mod.enviarPushDaOrg("org1", PAYLOAD, admin as never);
    expect(r).toEqual({ sent: 0, gone: 0, falha: "vapid_invalido" });
    expect(enviar).not.toHaveBeenCalled();
    expect(apagar).not.toHaveBeenCalled();
    expect(avisos).toEqual([{ evento: "web_push_vapid_invalido", dados: { motivo: "set_vapid_details_recusou" } }]);
  });

  it("o SUPPORT_EMAIL com '@' mas malformado ('suporte@'): o web-push ACEITA (medido), o envio segue, e o e-mail NÃO vai ao log", async () => {
    // MEDIDO (web-push 3.x, 18/11): todo 'mailto:' com '@' passa no setVapidDetails ('@', 'a b@c', '<a@b>', '%zz@x').
    // A recusa desse e-mail, se houver, é do serviço de push no envio (403), que já cai no try do sendNotification.
    const { mod, admin, enviar, avisos } = await webPushCom({ suporte: "suporte@", appUrl: "http://x" });
    const r = await mod.enviarPushDaOrg("org1", PAYLOAD, admin as never);
    expect(r.falha).toBeUndefined();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(avisos)).not.toContain("suporte@");
  });

  it("a chave pública recusada pelo web-push (tamanho errado): falha limpa, sem a chave no log", async () => {
    const { mod, admin, enviar, avisos } = await webPushCom({
      suporte: "suporte@loja.com.br",
      appUrl: "https://crm.exemplo",
      publica: "curta-demais",
    });
    const r = await mod.enviarPushDaOrg("org1", PAYLOAD, admin as never);
    expect(r).toEqual({ sent: 0, gone: 0, falha: "vapid_invalido" });
    expect(enviar).not.toHaveBeenCalled();
    expect(JSON.stringify(avisos)).not.toContain("curta-demais");
    expect(JSON.stringify(avisos)).not.toContain("suporte@loja.com.br");
  });

  it("a configuração CERTA (mailto: válido) continua mandando: a mudança não cala o push", async () => {
    const { mod, admin, enviar, avisos } = await webPushCom({ suporte: "suporte@loja.com.br", appUrl: "http://x" });
    const r = await mod.enviarPushDaOrg("org1", PAYLOAD, admin as never);
    expect(r).toEqual({ sent: 1, gone: 0 });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(avisos).toEqual([]);
  });

  it("o APP_URL em https: sem SUPPORT_EMAIL também é aceito", async () => {
    const { mod, admin, enviar } = await webPushCom({ suporte: "", appUrl: "https://crm.exemplo" });
    const r = await mod.enviarPushDaOrg("org1", PAYLOAD, admin as never);
    expect(r).toEqual({ sent: 1, gone: 0 });
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe("v1.9.64: o envio a várias pessoas para na 1ª recusa (a config é da instalação)", () => {
  beforeEach(() => vi.resetModules());

  it("enviarPushAosUsuarios devolve a falha e não repete para os outros", async () => {
    await webPushComEnvioFalso();
    vi.doMock("@/lib/env", () => ({
      env: { VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y", NEXT_PUBLIC_APP_URL: "http://localhost:3901" },
    }));
    vi.doMock("@/lib/instalacao/config", () => ({ valorDaInstalacao: async () => ({ valor: "" }) }));
    const avisos: string[] = [];
    vi.doMock("@/lib/logger", () => ({ logger: { warn: (e: string) => avisos.push(e), info: () => {}, error: () => {} } }));
    const consultas: string[] = [];
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (t: string) => {
          consultas.push(t);
          const q: Record<string, unknown> = {};
          q.select = () => q;
          q.is = () => q;
          q.not = () => q;
          q.maybeSingle = async () => ({ data: { user_id: "u" }, error: null });
          q.eq = () => q;
          q.then = (ok: (v: unknown) => unknown) =>
            ok({ data: [{ id: "s", endpoint: "https://127.0.0.1:9/x", p256dh: "p", auth: "a" }], error: null });
          return q;
        },
      }),
    }));
    const { enviarPushAosUsuarios } = await import("@/lib/notifications/web_push");
    const r = await enviarPushAosUsuarios("org1", ["u1", "u2", "u3"], PAYLOAD);
    expect(r).toEqual({ sent: 0, gone: 0, falha: "vapid_invalido" });
    expect(avisos).toEqual(["web_push_vapid_invalido"]);
    // só a 1ª pessoa foi consultada (o membro + as inscrições), as outras não
    expect(consultas).toEqual(["user_organizations", "push_subscriptions"]);
  });
});

describe("v1.9.64: o handler do drain e a rota de teste", () => {
  beforeEach(() => vi.resetModules());

  async function handlerComFalha() {
    const falha = { sent: 0, gone: 0, falha: "vapid_invalido" as const };
    vi.doMock("@/lib/notifications/web_push", () => ({
      enviarPushAosUsuarios: vi.fn(async () => falha),
      enviarPushAoUsuario: vi.fn(async () => falha),
      enviarPushDaOrg: vi.fn(async () => falha),
    }));
    vi.doMock("@/lib/notifications/quem-ve", () => ({
      inscritosQueVeem: async () => ["u-ve"],
      gerenciaInscrita: async () => ["u-gerente"],
    }));
    vi.doMock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true }));
    vi.doMock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
    vi.doMock("@/lib/channels/desativado", () => ({ canalDoEventoDesativado: async () => false }));
    vi.doMock("@/lib/branding/saida", () => ({ marcaDaSaida: async () => ({ nome: "Loja" }) }));
    vi.doMock("@/lib/notifications/push-dos-avisos", () => ({
      pushDoAvisoDaCentral: async () => ({ title: "Aviso", body: "b", tag: "t", href: "/app/central" }),
    }));
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => {
          const q: Record<string, unknown> = {};
          q.select = () => q;
          q.eq = () => q;
          q.maybeSingle = async () => ({ data: { title: "Lead", owner_user_id: "dono", pipeline_id: "p" }, error: null });
          return q;
        },
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
      }),
    }));
    return (await import("@/lib/notifications/push.handler")).webPushInboundHandler;
  }

  const linha = (event_type: string, payload: Record<string, unknown>) => ({
    id: "e", organization_id: "org1", event_type, entity_kind: "lead", entity_id: "item-1",
    payload, metadata: {}, consumed_by: [], attempts: 0,
  });

  it("a mensagem nova (muitos destinos) e o lead (1 dono): 'skipped' / 'vapid_invalido', sem lançar", async () => {
    const h = await handlerComFalha();
    const grupo = await h.handle(linha("message.group_received", { conversation_id: "c1", body_preview: "oi" }) as never);
    expect(grupo).toMatchObject({ status: "skipped", detail: "vapid_invalido" });
    const lead = await h.handle(linha("lead.assigned", { lead_id: "l1", owner_user_id: "dono" }) as never);
    expect(lead).toMatchObject({ status: "skipped", detail: "vapid_invalido" });
  });

  it("a rota 'Enviar um teste': 503 'unavailable' limpo, nunca 500", async () => {
    vi.doMock("@/lib/notifications/web_push", () => ({
      enviarPushAoUsuario: async () => ({ sent: 0, gone: 0, falha: "vapid_invalido" }),
    }));
    vi.doMock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true }));
    vi.doMock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
    vi.doMock("@/lib/auth/require-role", () => ({
      requireRole: async () => ({ ok: true, user: { id: "eu", idioma: "pt" }, org: { orgId: "org1" } }),
    }));
    const { POST } = await import("@/app/api/v1/notifications/push/teste/route");
    const r = await POST();
    expect(r.status).toBe(503);
    const corpo = JSON.stringify(await r.json());
    expect(corpo).toContain("unavailable");
    expect(corpo).toContain("mal configurado");
  });
});
