/**
 * ia.vek v1.9.45 (CRM-259, Rodrigo 11/11): até 50 MB no envio de foto, documento e áudio, como no vídeo,
 * e a tela avisa "Arquivo acima de 50 MB".
 *
 * MEDIDO antes de mexer (11/11): o bucket whatsapp-media aceita 50 MB, sem restrição de tipo; o Caddy
 * não tem limite de corpo; o WAHA (2026.7.2) não tem variável de tamanho; as rotas /media e
 * /notes/media já aceitam 50 MB. Quem cortava em 10 MB era o PROXY do Next (`proxyClientMaxBodySize`),
 * que guarda o corpo na memória, o mesmo corte que a v1.9.34 tirou do vídeo (CRM-258).
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { config } from "@/proxy";
import { MAX_MEDIA_BYTES } from "@/lib/messaging/media/types";
import { validateOutboundMedia } from "@/lib/messaging/media/upload-validation";

// O matcher do Next é "/<regex>": o proxy roda no caminho que casa.
const passaPeloProxy = (caminho: string) =>
  config.matcher.some((m) => new RegExp(`^${m}$`).test(caminho));

describe("v1.9.45 (CRM-259): mídia até 50 MB", () => {
  it("⭐ o envio de foto/documento/áudio e o anexo de nota NÃO passam pelo proxy (que corta em 10 MB)", () => {
    expect(passaPeloProxy("/api/v1/conversations/abc-123/media")).toBe(false);
    expect(passaPeloProxy("/api/v1/conversations/abc-123/notes/media")).toBe(false);
    expect(passaPeloProxy("/api/v1/conversations/abc-123/media/video")).toBe(false);
  });

  it("as rotas vizinhas CONTINUAM passando pelo proxy (o recorte é só das 3 rotas de envio)", () => {
    for (const c of [
      "/api/v1/conversations/abc-123/messages",
      "/api/v1/conversations/abc-123/media/video/trabalho-1",
      "/api/v1/conversations/abc-123/notes/n1/media",
      "/api/v1/conversations/abc-123/media-extra",
      "/app/inbox",
    ]) {
      expect(passaPeloProxy(c), c).toBe(true);
    }
  });

  it("as rotas que saem do proxy conferem login, papel e suporte sozinhas", () => {
    for (const f of ["app/api/v1/conversations/[id]/media/route.ts", "app/api/v1/conversations/[id]/notes/media/route.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toMatch(/await requireSupportWrite\(\)/);
      expect(s, f).toMatch(/await resolveAuthDual\(req,/);
    }
  });

  it("o teto é 50 MB para todo tipo, e a frase é 'Arquivo acima de 50 MB.'", () => {
    expect(MAX_MEDIA_BYTES).toBe(50 * 1024 * 1024);
    for (const mime of ["image/jpeg", "application/pdf", "audio/ogg", "video/mp4"]) {
      expect(validateOutboundMedia(mime, 49 * 1024 * 1024)).toMatchObject({ ok: true });
      expect(validateOutboundMedia(mime, MAX_MEDIA_BYTES + 1)).toEqual({
        ok: false,
        code: "payload_too_large",
        message: "Arquivo acima de 50 MB.",
      });
    }
  });
});

describe("v1.9.45 (CRM-259): a tela avisa ANTES de subir", () => {
  afterEach(() => vi.restoreAllMocks());

  it("⭐ arquivo acima de 50 MB não é enviado: o aviso 'Arquivo acima de 50 MB.' sai na hora", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { useUploadMedia } = await import("@/hooks/inbox/useUploadMedia");
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { createElement } = await import("react");
    const qc = new QueryClient();
    const { result } = renderHook(() => useUploadMedia(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: qc }, children),
    });
    const grande = { size: MAX_MEDIA_BYTES + 1, name: "foto.jpg" } as unknown as File;
    result.current.mutate({ conversationId: "c1", file: grande });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((result.current.error as { message?: string; code?: string }).code).toBe("payload_too_large");
    expect(String((result.current.error as { message?: string }).message)).toContain("Arquivo acima de 50 MB.");
  });
});
