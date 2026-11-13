/**
 * ia.vek v1.9.51.2 (Rodrigo 13/11 ~17:25Z): todo áudio vira texto, também o que o vendedor manda PELA TELA.
 * Antes: o áudio da tela (sent_via 'user') subia direto ao storage e ninguém pedia a transcrição (420 em 7 dias
 * na Fenômenos, todos sem texto). Agora o envio pela tela emite o MESMO `media.derive_requested` do persist; o
 * balão mostra "Transcrevendo…" enquanto isso e a "Transcrição" quando fica pronta (já era assim para o cliente).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MediaRenderer } from "@/components/inbox/media/MediaRenderer";
import { deveTranscreverAudioDaTela, pedirTranscricaoDoAudioDaTela } from "@/lib/iavek/transcricao-do-audio-da-tela";
import type { Message } from "@/lib/types/messaging";

const BASE = { id: "m1", organization_id: "o1", media_storage_path: "o1/c1/out-1.ogg" };

function adminFalso(erroDoEmit: string | null = null, lanca = false) {
  const rpc = vi.fn(async () => {
    if (lanca) throw new Error("rede caiu");
    return { error: erroDoEmit ? { message: erroDoEmit } : null };
  });
  const updates: unknown[] = [];
  const admin = {
    rpc,
    from: () => ({
      update: (v: unknown) => {
        updates.push(v);
        const q = { eq: () => q, then: (ok: () => void) => Promise.resolve().then(ok) };
        return q;
      },
    }),
  };
  return { admin: admin as never, rpc, updates };
}

describe("quem pede a transcrição: só o ÁUDIO enviado pela TELA", () => {
  it("áudio + sent_via 'user' + arquivo no storage: sim", () => {
    expect(deveTranscreverAudioDaTela({ type: "audio", sent_via: "user", media_storage_path: "x" })).toBe(true);
  });
  it("texto, imagem ou documento pela tela: não (imagem e documento já têm o caminho deles)", () => {
    for (const type of ["text", "image", "document", "video"]) {
      expect(deveTranscreverAudioDaTela({ type, sent_via: "user", media_storage_path: "x" })).toBe(false);
    }
  });
  it("áudio do celular ou do cliente: não aqui (o media-persist já pede; nada de pedido em dobro)", () => {
    expect(deveTranscreverAudioDaTela({ type: "audio", sent_via: "external_device", media_storage_path: "x" })).toBe(false);
    expect(deveTranscreverAudioDaTela({ type: "audio", sent_via: null, media_storage_path: "x" })).toBe(false);
  });
  it("áudio pela tela SEM arquivo no storage: não", () => {
    expect(deveTranscreverAudioDaTela({ type: "audio", sent_via: "user", media_storage_path: null })).toBe(false);
  });
});

describe("o pedido", () => {
  it("emite 1 media.derive_requested com o id da mensagem e a org", async () => {
    const f = adminFalso();
    const r = await pedirTranscricaoDoAudioDaTela(f.admin, { ...BASE, type: "audio", sent_via: "user" });
    expect(r).toBe("pedido");
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith(
      "emit_event",
      expect.objectContaining({
        p_event_type: "media.derive_requested",
        p_entity_kind: "message",
        p_entity_id: "m1",
        p_payload: { message_id: "m1" },
        p_organization_id: "o1",
      }),
    );
    expect(f.updates).toHaveLength(0);
  });
  it("texto pela tela: 0 pedido", async () => {
    const f = adminFalso();
    expect(await pedirTranscricaoDoAudioDaTela(f.admin, { ...BASE, type: "text", sent_via: "user" })).toBe("ignorado");
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("o emit falha: NÃO lança (o envio segue) e marca 'failed' para o balão não esperar para sempre", async () => {
    const f = adminFalso("emit_event indisponível");
    await expect(pedirTranscricaoDoAudioDaTela(f.admin, { ...BASE, type: "audio", sent_via: "user" })).resolves.toBe("falhou");
    expect(f.updates).toEqual([{ media_derived_status: "failed" }]);
  });
  it("o emit LANÇA (rede): também não derruba o envio", async () => {
    const f = adminFalso(null, true);
    await expect(pedirTranscricaoDoAudioDaTela(f.admin, { ...BASE, type: "audio", sent_via: "user" })).resolves.toBe("falhou");
  });
});

function audio(over: Partial<Message>): Message {
  return {
    id: "m1", conversation_id: "c1", contact_id: "ct1", channel_session_id: "s1", external_id: "x1",
    type: "audio", direction: "outbound", status: "sent", ack: null, body: null, media_url: null, media_mime: "audio/ogg",
    media_size_bytes: null, media_storage_path: "o1/c1/out-1.ogg", sent_via: "user",
    sent_at: "2026-11-13T17:08:54.000Z", delivered_at: null, read_at: null, error_code: null, error_message: null,
    metadata: {}, created_at: "2026-11-13T17:08:54.000Z", media_derived_status: null, media_derived_text: null,
    ...over,
  } as Message;
}
const LOGO_DEPOIS = Date.parse("2026-11-13T17:09:30.000Z");

describe("o balão do áudio enviado pela tela", () => {
  it("logo depois do envio, sem status: 'Transcrevendo…'", () => {
    render(<MediaRenderer message={audio({})} agora={LOGO_DEPOIS} />);
    expect(screen.getByTestId("transcricao-de-audio-pendente")).toHaveTextContent("Transcrevendo…");
  });
  it("pronto: a 'Transcrição' com o texto, embaixo do player", () => {
    render(<MediaRenderer message={audio({ media_derived_status: "ready", media_derived_text: "oi, tudo certo com o carro" })} agora={LOGO_DEPOIS} />);
    expect(screen.getByTestId("transcricao-de-audio")).toHaveTextContent("oi, tudo certo com o carro");
  });
});
