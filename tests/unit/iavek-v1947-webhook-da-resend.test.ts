/**
 * ia.vek v1.9.47 (0627): a rota do webhook da Resend — sem segredo 503, assinatura errada 401 (nada gravado),
 * assinatura certa 200 (o evento é aplicado), erro ao gravar 500 (a Resend reentrega).
 */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const SEGREDO = `whsec_${Buffer.from("segredo-de-teste-0627-com-32-bytes!").toString("base64")}`;
function assinar(id: string, ts: string, corpo: string, segredo = SEGREDO): string {
  const chave = Buffer.from(segredo.slice(6), "base64");
  return `v1,${createHmac("sha256", chave).update(`${id}.${ts}.${corpo}`).digest("base64")}`;
}

// ── a rota do webhook ────────────────────────────────────────────────────────
const envMock = { RESEND_WEBHOOK_SECRET: "" };
vi.mock("@/lib/env", () => ({ env: new Proxy({}, { get: (_t, k) => (envMock as Record<string, unknown>)[k as string] }) }));
const aplicado = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ marca: "admin" }) }));
vi.mock("@/lib/email/entregas", async (orig) => {
  const real = await orig<typeof import("@/lib/email/entregas")>();
  return { ...real, aplicarEventoDeEntrega: (...a: unknown[]) => aplicado(...a) };
});

describe("POST /api/v1/webhooks/resend", () => {
  beforeEach(() => {
    aplicado.mockReset();
    aplicado.mockResolvedValue({ aplicado: true, estado: "entregue" });
  });
  async function post(corpo: string, cab: Record<string, string>) {
    const { POST } = await import("@/app/api/v1/webhooks/resend/route");
    const { NextRequest } = await import("next/server");
    return POST(new NextRequest("http://x/api/v1/webhooks/resend", { method: "POST", body: corpo, headers: cab }));
  }
  it("sem o segredo no servidor: 503 e nada é lido", async () => {
    envMock.RESEND_WEBHOOK_SECRET = "";
    expect((await post("{}", {})).status).toBe(503);
    expect(aplicado).not.toHaveBeenCalled();
  });
  it("assinatura errada: 401 e nada é gravado", async () => {
    envMock.RESEND_WEBHOOK_SECRET = SEGREDO;
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await post('{"type":"email.bounced","data":{"email_id":"e1"}}', { "svix-id": "m1", "svix-timestamp": ts, "svix-signature": "v1,AAAA" });
    expect(r.status).toBe(401);
    expect(aplicado).not.toHaveBeenCalled();
  });
  it("assinatura certa: 200 e o evento é aplicado", async () => {
    envMock.RESEND_WEBHOOK_SECRET = SEGREDO;
    const ts = String(Math.floor(Date.now() / 1000));
    const corpo = '{"type":"email.delivered","data":{"email_id":"e1"}}';
    const r = await post(corpo, { "svix-id": "m1", "svix-timestamp": ts, "svix-signature": assinar("m1", ts, corpo) });
    expect(r.status).toBe(200);
    expect(aplicado).toHaveBeenCalledWith({ marca: "admin" }, { type: "email.delivered", data: { email_id: "e1" } });
  });
  it("erro ao gravar: 500 (a Resend reentrega)", async () => {
    envMock.RESEND_WEBHOOK_SECRET = SEGREDO;
    aplicado.mockResolvedValue({ aplicado: false, motivo: "erro" });
    const ts = String(Math.floor(Date.now() / 1000));
    const corpo = '{"type":"email.delivered","data":{"email_id":"e1"}}';
    expect((await post(corpo, { "svix-id": "m1", "svix-timestamp": ts, "svix-signature": assinar("m1", ts, corpo) })).status).toBe(500);
  });
});
