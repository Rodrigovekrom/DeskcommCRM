/**
 * ia.vek v1.9.49 (notas (c) da Lupa, 033156 e 033232): a corrida do id desconhecido no webhook da Resend.
 *   - id desconhecido + EVENTO recente (created_at do corpo assinado, até 10 min) = 409 (a Resend reentrega);
 *   - evento velho, sem created_at ou com created_at ilegível/no futuro = 200 e ignorado;
 *   - a idade NUNCA vem do svix-timestamp (renova a cada reentrega = laço eterno).
 */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const SEGREDO = `whsec_${Buffer.from("segredo-de-teste-0627-com-32-bytes!").toString("base64")}`;
function assinar(id: string, ts: string, corpo: string): string {
  const chave = Buffer.from(SEGREDO.slice(6), "base64");
  return `v1,${createHmac("sha256", chave).update(`${id}.${ts}.${corpo}`).digest("base64")}`;
}

const envMock = { RESEND_WEBHOOK_SECRET: SEGREDO };
vi.mock("@/lib/env", () => ({ env: new Proxy({}, { get: (_t, k) => (envMock as Record<string, unknown>)[k as string] }) }));
const aplicado = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ marca: "admin" }) }));
vi.mock("@/lib/email/entregas", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return { ...real, aplicarEventoDeEntrega: (...a: unknown[]) => aplicado(...a) };
});

async function post(evento: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/webhooks/resend/route");
  const { NextRequest } = await import("next/server");
  const corpo = JSON.stringify(evento);
  // o svix-timestamp é SEMPRE agora (como numa reentrega): ele não pode decidir a idade
  const ts = String(Math.floor(Date.now() / 1000));
  return POST(
    new NextRequest("http://x/api/v1/webhooks/resend", {
      method: "POST",
      body: corpo,
      headers: { "svix-id": "m1", "svix-timestamp": ts, "svix-signature": assinar("m1", ts, corpo) },
    }),
  );
}

const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("o webhook com o id ainda não gravado", () => {
  beforeEach(() => {
    aplicado.mockReset();
    aplicado.mockResolvedValue({ aplicado: false, motivo: "id_desconhecido" });
  });

  it("evento de 1 min atrás: 409 (a Resend reentrega; o envio ainda gravava a linha)", async () => {
    expect((await post({ type: "email.delivered", created_at: minutosAtras(1), data: { email_id: "e1" } })).status).toBe(409);
  });

  it("evento de 30 min atrás: 200 e ignorado (não é nosso), MESMO com o svix-timestamp de agora", async () => {
    expect((await post({ type: "email.delivered", created_at: minutosAtras(30), data: { email_id: "e1" } })).status).toBe(200);
  });

  it("sem created_at, ilegível ou no futuro: 200 e ignorado (nunca vira reentrega)", async () => {
    for (const c of [undefined, "ontem", 12345, new Date(Date.now() + 60 * 60_000).toISOString()]) {
      const ev: Record<string, unknown> = { type: "email.delivered", data: { email_id: "e1" } };
      if (c !== undefined) ev.created_at = c;
      expect((await post(ev)).status).toBe(200);
    }
  });

  it("id CONHECIDO: segue 200 e aplicado (o 409 é só para o desconhecido)", async () => {
    aplicado.mockResolvedValue({ aplicado: true, estado: "entregue" });
    expect((await post({ type: "email.delivered", created_at: minutosAtras(1), data: { email_id: "e1" } })).status).toBe(200);
  });
});

describe("eventoRecente (a regra pura)", () => {
  it("a janela é de 10 min pelo created_at do evento; folga de 5 min de relógio para o futuro", async () => {
    const { eventoRecente, JANELA_DO_EVENTO_RECENTE_MS } = await import("@/lib/email/entregas");
    const agora = Date.parse("2026-11-13T15:00:00Z");
    expect(JANELA_DO_EVENTO_RECENTE_MS).toBe(10 * 60_000);
    expect(eventoRecente({ created_at: "2026-11-13T14:51:00Z" }, agora)).toBe(true);
    expect(eventoRecente({ created_at: "2026-11-13T14:49:59Z" }, agora)).toBe(false);
    expect(eventoRecente({ created_at: "2026-11-13T15:04:00Z" }, agora)).toBe(true);
    expect(eventoRecente({ created_at: "2026-11-13T15:06:00Z" }, agora)).toBe(false);
    expect(eventoRecente({}, agora)).toBe(false);
  });

  it("a rota NÃO usa o svix-timestamp para a idade (só para a assinatura)", async () => {
    const { readFileSync } = await import("node:fs");
    const r = readFileSync("app/api/v1/webhooks/resend/route.ts", "utf8");
    expect(r).toContain('desfecho.motivo === "id_desconhecido" && eventoRecente(evento)');
    expect(r.match(/req\.headers\.get\("svix-timestamp"\)/g)?.length).toBe(1); // só a leitura da assinatura
  });
});
