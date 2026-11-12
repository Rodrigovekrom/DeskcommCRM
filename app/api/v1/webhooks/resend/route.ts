/**
 * POST /api/v1/webhooks/resend — ia.vek v1.9.47 (0627): a Resend conta se o e-mail chegou.
 *
 * Público na borda (`/api/v1/webhooks/` em lib/auth/public-paths.ts): a autenticação é a ASSINATURA Svix, conferida
 * aqui com o RESEND_WEBHOOK_SECRET do servidor. Sem o segredo, recusa tudo (503: a Resend reentrega mais tarde).
 * Assinatura errada ou relógio fora de 5 min: 401, nada é lido. Evento de um e-mail que não é nosso: 200 e
 * ignorado (nunca cria linha de fora). O corpo NUNCA vai para o log (tem o endereço de quem recebe).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { aplicarEventoDeEntrega, conferirAssinaturaDoWebhook, type EventoDaResend } from "@/lib/email/entregas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Um evento de entrega é pequeno; corpo grande é outra coisa. */
const TETO_DO_CORPO = 256 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!env.RESEND_WEBHOOK_SECRET) {
    return fail("unavailable", "O webhook da Resend não está configurado neste servidor.", 503, { requestId });
  }
  const corpo = await req.text();
  if (corpo.length > TETO_DO_CORPO) return fail("payload_too_large", "Corpo grande demais.", 413, { requestId });
  const conferida = conferirAssinaturaDoWebhook({
    segredo: env.RESEND_WEBHOOK_SECRET,
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    assinatura: req.headers.get("svix-signature"),
    corpo,
  });
  if (!conferida.ok) {
    logger.warn("resend_webhook_recusado", { motivo: conferida.motivo });
    return fail("unauthorized", "Assinatura inválida.", 401, { requestId });
  }
  let evento: EventoDaResend;
  try {
    evento = JSON.parse(corpo) as EventoDaResend;
  } catch {
    return fail("validation_failed", "JSON inválido.", 400, { requestId });
  }
  const desfecho = await aplicarEventoDeEntrega(createAdminClient(), evento);
  if (!desfecho.aplicado && desfecho.motivo === "erro") {
    // 500: a Resend reentrega; o estado não se perde
    return fail("internal_error", "Não deu para gravar agora.", 500, { requestId });
  }
  logger.info("resend_webhook", {
    tipo: typeof evento.type === "string" ? evento.type.slice(0, 40) : null,
    ...(desfecho.aplicado ? { estado: desfecho.estado } : { ignorado: desfecho.motivo }),
  });
  return ok({ recebido: true }, { requestId });
}
