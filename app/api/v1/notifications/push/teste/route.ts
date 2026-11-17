/**
 * POST /api/v1/notifications/push/teste — ia.vek CRM-530: o botão "Enviar um teste" da tela de Notificações.
 *
 * Manda UM aviso SÓ ao próprio usuário (todas as inscrições dele nesta org), para ele ver e ouvir na hora, com o CRM
 * fechado ou minimizado. Nunca a outra pessoa: o destino é o `user.id` da sessão, não algo que venha no corpo.
 * Limite: 1 teste por minuto por pessoa (por processo; o objetivo é não virar campainha, não auditoria).
 * Responde quantos aparelhos receberam (`enviados`), para a tela dizer "nenhum aparelho inscrito" quando for 0.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { vapidPronto } from "@/lib/notifications/vapid";
import { enviarPushAoUsuario } from "@/lib/notifications/web_push";

export const dynamic = "force-dynamic";

const UM_MINUTO_MS = 60_000;
const ultimoTeste = new Map<string, number>();

export async function POST(): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "push_subscriptions" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  if (!vapidPronto()) {
    return fail("unavailable", t("Web Push não configurado nesta instalação."), 503, { requestId });
  }

  const chave = `${authz.org.orgId}:${authz.user.id}`;
  const agora = Date.now();
  const antes = ultimoTeste.get(chave) ?? 0;
  if (agora - antes < UM_MINUTO_MS) {
    return fail("rate_limited", t("Espere um minuto para enviar outro teste."), 429, { requestId });
  }
  ultimoTeste.set(chave, agora);

  const { sent } = await enviarPushAoUsuario(authz.org.orgId, authz.user.id, {
    title: t("Teste do CRM"),
    body: t("Se você ouviu, o aviso no celular está funcionando."),
    tag: "teste",
    href: "/app/settings/notifications",
  });
  return ok({ enviados: sent }, { requestId });
}
