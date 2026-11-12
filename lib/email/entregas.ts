/**
 * ia.vek v1.9.47 (0627): saber se o e-mail CHEGOU (Maestro 210359, da Lupa).
 *
 * Três peças, todas do servidor:
 *   1. `registrarEnvioDeEmail` — no envio aceito pela Resend, grava a linha (mensagem_id = o id da Resend) em
 *      `iavek_entregas_de_email`. NUNCA lança: o registro é para acompanhar, e o envio já deu certo.
 *   2. `conferirAssinaturaDoWebhook` — a assinatura Svix que a Resend põe em cada webhook (svix-id,
 *      svix-timestamp, svix-signature), com o segredo `whsec_…` do .env do servidor (RESEND_WEBHOOK_SECRET). Sem
 *      segredo, nada é aceito (falha fechada). Tolerância de 5 min no relógio, contra reenvio de evento velho.
 *   3. `aplicarEventoDeEntrega` — o estado só SOBE (enviado < atrasado < entregue < voltou/spam/falhou); evento de
 *      um id que não temos é IGNORADO (nunca cria linha de fora: a mesma conta Resend pode servir outro sistema).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";

export const TABELA_DAS_ENTREGAS = "iavek_entregas_de_email";

export type EstadoDaEntrega = "enviado" | "atrasado" | "entregue" | "voltou" | "spam" | "falhou";

/** A ordem: o estado só sobe. Os três finais ruins têm o mesmo peso (o primeiro que chegar fica). */
export const PESO_DO_ESTADO: Record<EstadoDaEntrega, number> = {
  enviado: 0,
  atrasado: 1,
  entregue: 2,
  voltou: 3,
  spam: 3,
  falhou: 3,
};

/** Os eventos da Resend que contam para a entrega. Os outros (aberto, clicado...) não mudam nada. */
export const ESTADO_DO_EVENTO: Readonly<Record<string, EstadoDaEntrega>> = {
  "email.sent": "enviado",
  "email.delivery_delayed": "atrasado",
  "email.delivered": "entregue",
  "email.bounced": "voltou",
  "email.complained": "spam",
  "email.failed": "falhou",
};

export const TOLERANCIA_DO_RELOGIO_S = 5 * 60;

export interface Rastreio {
  organizationId?: string | null;
  tipo?: string | null;
  recursoId?: string | null;
}

/** Tira e-mail e quebra de linha do texto que vem de fora, e corta. */
export function limparDetalhe(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  const limpo = texto
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<email>")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 300);
  return limpo.length > 0 ? limpo : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function registrarEnvioDeEmail(
  admin: Pick<SupabaseClient, "from">,
  mensagemId: string,
  rastreio: Rastreio,
): Promise<void> {
  try {
    if (!mensagemId || mensagemId.length > 200) return;
    const org = rastreio.organizationId && UUID.test(rastreio.organizationId) ? rastreio.organizationId : null;
    const { error } = await admin.from(TABELA_DAS_ENTREGAS).upsert(
      {
        mensagem_id: mensagemId,
        provedor: "resend",
        organization_id: org,
        tipo: rastreio.tipo ? rastreio.tipo.slice(0, 60) : null,
        recurso_id: rastreio.recursoId ? rastreio.recursoId.slice(0, 100) : null,
      },
      { onConflict: "mensagem_id", ignoreDuplicates: true },
    );
    if (error) logger.warn("email_entrega_registro_falhou", { codigo: error.code ?? null });
  } catch (err) {
    logger.warn("email_entrega_registro_falhou", { erro: err instanceof Error ? err.name : "desconhecido" });
  }
}

/**
 * A assinatura Svix: HMAC-SHA256 de `${svix-id}.${svix-timestamp}.${corpo}`, com a chave = base64 do segredo
 * sem o `whsec_`. O cabeçalho `svix-signature` traz uma ou mais `v1,<base64>` separadas por espaço.
 */
export function conferirAssinaturaDoWebhook(p: {
  segredo: string;
  id: string | null;
  timestamp: string | null;
  assinatura: string | null;
  corpo: string;
  agoraS?: number;
}): { ok: true } | { ok: false; motivo: "sem_segredo" | "cabecalho_faltando" | "relogio" | "assinatura" } {
  const segredo = (p.segredo ?? "").trim();
  if (!segredo.startsWith("whsec_") || segredo.length < 12) return { ok: false, motivo: "sem_segredo" };
  if (!p.id || !p.timestamp || !p.assinatura) return { ok: false, motivo: "cabecalho_faltando" };
  const ts = Number(p.timestamp);
  const agora = p.agoraS ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(agora - ts) > TOLERANCIA_DO_RELOGIO_S) return { ok: false, motivo: "relogio" };
  const chave = Buffer.from(segredo.slice("whsec_".length), "base64");
  const esperada = createHmac("sha256", chave).update(`${p.id}.${p.timestamp}.${p.corpo}`).digest();
  for (const parte of p.assinatura.split(" ")) {
    const [versao, valor] = parte.split(",", 2);
    if (versao !== "v1" || !valor) continue;
    const recebida = Buffer.from(valor, "base64");
    if (recebida.length === esperada.length && timingSafeEqual(recebida, esperada)) return { ok: true };
  }
  return { ok: false, motivo: "assinatura" };
}

export interface EventoDaResend {
  type?: unknown;
  data?: { email_id?: unknown; bounce?: { message?: unknown } | null; failed?: { reason?: unknown } | null } | null;
}

export type DesfechoDoEvento =
  | { aplicado: true; estado: EstadoDaEntrega }
  | { aplicado: false; motivo: "evento_que_nao_conta" | "sem_id" | "id_desconhecido" | "estado_nao_sobe" | "erro" };

export async function aplicarEventoDeEntrega(
  admin: Pick<SupabaseClient, "from">,
  evento: EventoDaResend,
): Promise<DesfechoDoEvento> {
  const estado = typeof evento.type === "string" ? ESTADO_DO_EVENTO[evento.type] : undefined;
  if (!estado) return { aplicado: false, motivo: "evento_que_nao_conta" };
  const id = evento.data?.email_id;
  if (typeof id !== "string" || id.length === 0 || id.length > 200) return { aplicado: false, motivo: "sem_id" };

  const { data: atual, error } = await admin
    .from(TABELA_DAS_ENTREGAS)
    .select("estado")
    .eq("mensagem_id", id)
    .maybeSingle();
  if (error) return { aplicado: false, motivo: "erro" };
  if (!atual) return { aplicado: false, motivo: "id_desconhecido" };
  const antes = (atual as { estado: EstadoDaEntrega }).estado;
  if (PESO_DO_ESTADO[estado] <= (PESO_DO_ESTADO[antes] ?? 0)) return { aplicado: false, motivo: "estado_nao_sobe" };

  const detalhe = limparDetalhe(evento.data?.bounce?.message ?? evento.data?.failed?.reason ?? null);
  // condicional no estado de antes: duas entregas do webhook ao mesmo tempo nunca descem o estado
  const { data: mudou, error: erroUpdate } = await admin
    .from(TABELA_DAS_ENTREGAS)
    .update({ estado, detalhe, atualizado_em: new Date().toISOString() })
    .eq("mensagem_id", id)
    .eq("estado", antes)
    .select("mensagem_id")
    .maybeSingle();
  if (erroUpdate) return { aplicado: false, motivo: "erro" };
  if (!mudou) return { aplicado: false, motivo: "estado_nao_sobe" };
  return { aplicado: true, estado };
}
