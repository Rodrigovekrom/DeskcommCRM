// @vitest-environment node
/**
 * ia.vek v1.9.45 (CRM-259) — BLOQUEIO da Lupa: com /media e /notes/media FORA do proxy (que cortava em
 * 10 MB), um envio CHUNKED (sem Content-Length) passava pelo teto declarado (`declared = 0`), e o
 * `req.formData()` guardava o corpo inteiro na memória, sem teto. Agora a rota lê contando os bytes
 * (formDataComTeto) e corta ao passar de 50 MB + 1 MB, como a rota do vídeo.
 *
 * O teste manda 60 MB em stream (pedaços de 1 MB gerados sob demanda, duplex "half", SEM Content-Length)
 * e mede quanto do stream a rota PUXOU: tem de parar logo depois do teto (não ler os 60 MB) e responder 413.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/ai/dispatcher/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/mcp/auth", async () => {
  const orig = await vi.importActual<typeof import("@/lib/mcp/auth")>("@/lib/mcp/auth");
  return { ...orig, validateBearerToken: vi.fn() };
});

const { validateBearerToken } = await import("@/lib/mcp/auth");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { createClient } = await import("@/lib/supabase/server");
const { MAX_MEDIA_BYTES } = await import("@/lib/messaging/media/types");
const { formDataComTeto } = await import("@/lib/messaging/media/form-data-com-teto");

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "33333333-3333-4333-8333-333333333333";
const MB = 1024 * 1024;
const TETO = MAX_MEDIA_BYTES + MB;

function clienteComConversa() {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, { select: () => chain, eq: () => chain, maybeSingle: vi.fn(async () => ({ data: { id: CONV_ID }, error: null })) });
  return { from: vi.fn(() => chain) };
}

/** 60 MB em pedaços de 1 MB, gerados SOB DEMANDA (pull): conta quanto a rota puxou. */
function streamDe60MB() {
  const pedaco = new Uint8Array(MB);
  const medido = { puxados: 0, cancelado: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (medido.puxados >= 60 * MB) return c.close();
      medido.puxados += MB;
      c.enqueue(pedaco);
    },
    cancel() {
      medido.cancelado = true;
    },
  });
  return { stream, medido };
}

function chunked(caminho: string, stream: ReadableStream<Uint8Array>): NextRequest {
  return new NextRequest(`http://localhost${caminho}`, {
    method: "POST",
    headers: { authorization: "Bearer dsk_abc_def", "content-type": "multipart/form-data; boundary=x" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue(clienteComConversa() as never);
  vi.mocked(createClient).mockResolvedValue(clienteComConversa() as never);
  vi.mocked(validateBearerToken).mockResolvedValue({
    organizationId: ORG_ID,
    role: "agent" as never,
    actor: { type: "api_token", id: "tok-1", role: "agent" as never },
    apiTokenId: "tok-1",
    scopes: ["mcp:write"],
  });
});

describe("v1.9.45 (CRM-259): envio chunked de 60 MB, SEM Content-Length", () => {
  for (const [nome, caminho, importar] of [
    ["/media", `/api/v1/conversations/${CONV_ID}/media`, () => import("@/app/api/v1/conversations/[id]/media/route")],
    ["/notes/media", `/api/v1/conversations/${CONV_ID}/notes/media`, () => import("@/app/api/v1/conversations/[id]/notes/media/route")],
  ] as const) {
    it(`⭐ ${nome}: recusa com 413 e para de ler logo depois do teto (não puxa os 60 MB)`, async () => {
      const { POST } = await importar();
      const { stream, medido } = streamDe60MB();
      const req = chunked(caminho, stream);
      expect(req.headers.get("content-length")).toBeNull(); // é mesmo chunked
      const res = await POST(req, { params: Promise.resolve({ id: CONV_ID }) });
      expect(res.status).toBe(413);
      expect(medido.puxados).toBeLessThanOrEqual(TETO + 2 * MB); // parou no teto (+ o pedaço que estourou e o já enfileirado)
      expect(medido.puxados).toBeLessThan(60 * MB);
    });
  }

  it("formDataComTeto: dentro do teto lê o multipart normalmente; acima, para e cancela o stream", async () => {
    const pequeno = new FormData();
    pequeno.append("file", new File([new Uint8Array(1000)], "foto.jpg", { type: "image/jpeg" }));
    const r1 = await formDataComTeto(new Request("http://x", { method: "POST", body: pequeno }), TETO);
    expect(r1.ok && (r1.form.get("file") as File).size).toBe(1000);

    const { stream, medido } = streamDe60MB();
    const r2 = await formDataComTeto(chunked("/x", stream), 5 * MB);
    expect(r2).toMatchObject({ ok: false, motivo: "grande" });
    expect(medido.cancelado).toBe(true);
    expect(medido.puxados).toBeLessThanOrEqual(7 * MB);
  });
});
