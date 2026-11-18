import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { vapidPronto, vapidPublica, vapidSubject } from "./vapid";
import type { PushPayload } from "./push_payload";

export type PushSubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type AdminLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: PushSubRow[] | null; error: { message: string } | null }>;
    };
    delete: () => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

/**
 * ia.vek v1.9.64 (achado da Lupa 1232): o resultado de um envio. `falha` só quando a instalação está MAL configurada
 * (o `setVapidDetails` recusou o subject ou as chaves, ex.: o SUPPORT_EMAIL com '@' mas inválido, ou o
 * NEXT_PUBLIC_APP_URL em http:). Antes, o throw saía FORA do try e virava 500 na rota e erro no drain.
 */
export type ResultadoPush = { sent: number; gone: number; falha?: "vapid_invalido" };

function store(admin: AdminLike) {
  return admin.from("push_subscriptions");
}

export async function enviarPushDaOrg(
  organizationId: string,
  payload: PushPayload,
  admin: AdminLike = createAdminClient() as unknown as AdminLike,
): Promise<ResultadoPush> {
  if (!vapidPronto()) return { sent: 0, gone: 0 };

  const { data, error } = await store(admin).select("id, endpoint, p256dh, auth").eq("organization_id", organizationId);
  if (error) {
    logger.warn("push_subscriptions_list_failed", { detail: error.message });
    return { sent: 0, gone: 0 };
  }
  const rows = data ?? [];
  if (rows.length === 0) return { sent: 0, gone: 0 };

  try {
    webpush.setVapidDetails(await vapidSubject(), vapidPublica()!, env.VAPID_PRIVATE_KEY.trim());
  } catch {
    // a mensagem do web-push repete o subject (o e-mail de suporte): não vai ao log; só o motivo fixo
    logger.warn("web_push_vapid_invalido", { motivo: "set_vapid_details_recusou" });
    return { sent: 0, gone: 0, falha: "vapid_invalido" };
  }

  let sent = 0;
  let gone = 0;
  const body = JSON.stringify(payload);

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          gone += 1;
          await store(admin).delete().eq("id", row.id);
          return;
        }
        logger.warn("web_push_send_failed", { status: status ?? 0 });
      }
    }),
  );

  return { sent, gone };
}

export async function enviarPushAoUsuario(
  organizationId: string,
  userId: string,
  payload: PushPayload,
): Promise<ResultadoPush> {
  if (!vapidPronto()) return { sent: 0, gone: 0 };
  const admin = createAdminClient();
  // ia.vek CRM-530: só membro ATIVO da org recebe (aceito e não revogado). Quem saiu da loja não recebe, mesmo com a
  // inscrição antiga no aparelho.
  const { data: membro, error: membroErr } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (membroErr || !membro) return { sent: 0, gone: 0 };
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (error) {
    logger.warn("push_subscriptions_user_list_failed", { detail: error.message });
    return { sent: 0, gone: 0 };
  }
  return enviarPushDaOrg(organizationId, payload, {
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({ data: (data ?? []) as PushSubRow[], error: null }),
      }),
      delete: () => ({
        eq: async (col: string, val: string) => {
          const { error: delErr } = await admin.from(table).delete().eq(col, val);
          return { error: delErr };
        },
      }),
    }),
  });
}

/**
 * ia.vek CRM-530: manda a cada pessoa da lista (sem repetir), por `enviarPushAoUsuario`, que confere o membro ativo.
 * É o caminho de toda mensagem e aviso da Central: nunca mais `enviarPushDaOrg` para eles (a cerca está nos testes).
 */
export async function enviarPushAosUsuarios(
  organizationId: string,
  userIds: readonly string[],
  payload: PushPayload,
): Promise<ResultadoPush> {
  let sent = 0;
  let gone = 0;
  for (const userId of [...new Set(userIds)]) {
    const r = await enviarPushAoUsuario(organizationId, userId, payload);
    // a configuração é da instalação: se recusou para um, recusa para todos; para aqui, sem repetir o aviso no log
    if (r.falha) return { sent, gone, falha: r.falha };
    sent += r.sent;
    gone += r.gone;
  }
  return { sent, gone };
}
