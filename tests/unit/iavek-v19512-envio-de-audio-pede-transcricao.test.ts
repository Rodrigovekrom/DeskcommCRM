/**
 * ia.vek v1.9.51.2: o ENVIO pelo handler de verdade (sendMessageHandler) pede a transcrição do áudio da tela — e só dele.
 * Mesmo dublê do handler dos outros testes de envio; o admin é dublado para capturar o `emit_event`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

const emitidos = vi.hoisted(() => [] as Array<{ fn: string; args: Record<string, unknown> }>);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "http://assinada/x" }, error: null }) }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      emitidos.push({ fn, args });
      return { error: null };
    },
    from: () => ({ update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }),
  }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ctx: HandlerCtx = { organization_id: ORG, actor: { type: "user", id: USER }, requestId: "req-1" };

function duble() {
  return criarDubleDoHandler({
    conversation: {
      id: CONV,
      organization_id: ORG,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      is_group: false,
      group_chat_id: null,
      contacts: { phone_number: "+5531999998888", wa_identity: null, is_blocked: false },
      channel_sessions: { provider: "waha", waha_session_name: "default", status: "WORKING", archived_at: null },
    },
  });
}
const pedidosDeTranscricao = () =>
  emitidos.filter((e) => e.fn === "emit_event" && e.args.p_event_type === "media.derive_requested");

describe("sendMessageHandler: o áudio enviado pela TELA pede a transcrição", () => {
  beforeEach(() => {
    emitidos.length = 0;
    vi.stubEnv("WAHA_API_BASE_URL", "http://localhost:3030");
    vi.stubEnv("WAHA_API_KEY", "hash123");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("áudio pela tela (ator usuário, arquivo no storage da conversa): 1 media.derive_requested", async () => {
    const { supabase } = duble();
    await sendMessageHandler(supabase, ctx, {
      conversation_id: CONV,
      type: "audio",
      media_storage_path: `${ORG}/${CONV}/out-1.ogg`,
      media_mime: "audio/ogg",
    } as SendMessageInput).catch(() => undefined); // o canal falso pode falhar depois: o pedido sai ANTES do envio
    const p = pedidosDeTranscricao();
    expect(p).toHaveLength(1);
    expect(p[0]?.args).toMatchObject({ p_entity_kind: "message", p_organization_id: ORG, p_metadata: { source: "envio_pela_tela" } });
  });

  it("texto pela tela: 0 pedido", async () => {
    const { supabase } = duble();
    await sendMessageHandler(supabase, ctx, { conversation_id: CONV, type: "text", body: "oi" } as SendMessageInput).catch(() => undefined);
    expect(pedidosDeTranscricao()).toHaveLength(0);
  });

  it("imagem pela tela: 0 pedido (só áudio vira texto por este caminho)", async () => {
    const { supabase } = duble();
    await sendMessageHandler(supabase, ctx, {
      conversation_id: CONV,
      type: "image",
      media_storage_path: `${ORG}/${CONV}/out-2.jpg`,
      media_mime: "image/jpeg",
    } as SendMessageInput).catch(() => undefined);
    expect(pedidosDeTranscricao()).toHaveLength(0);
  });
});
