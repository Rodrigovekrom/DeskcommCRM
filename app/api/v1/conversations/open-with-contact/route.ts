import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/conversations/open-with-contact
 *
 * Resolve o contato do cartão compartilhado e abre a conversa 1:1 na mesma sessão
 * de canal — comportamento equivalente ao toque no contato no WhatsApp.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { contatoExistenteDaAbertura, openSharedContactConversation } from "@/lib/messaging/open-shared-contact-conversation";
import { openConversationWithContactSchema, validateRequest } from "@/lib/schemas";
import { contatoNoAlcance } from "@/lib/iavek/contato-no-alcance";
import { createAdminClient } from "@/lib/supabase/admin";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();

  // Sessão de navegador OU token de servidor: é o passo que antecede o envio,
  // e quem envia por token precisa poder resolver a conversa pelo telefone.
  const authz = await resolveAuthDual(req, {
    requestId,
    resource: "conversations",
    role: "agent",
    scope: "mcp:write",
  });
  if (!authz.ok) return authz.response;
  // Rota que aceita Bearer (PUBLIC_PATHS): sem estrangulamento a montante, o
  // que não for contado aqui não é contado em lugar nenhum — mesmo teto das
  // irmãs que já aplicam sobre resolveAuthDual.
  const teto = await tetoDeEscritaDoToken(authz, "conversations.open", requestId);
  if (teto) return teto;
  // O ramo do token não carrega idioma de usuário: cai no padrão do produto.
  const t = (texto: string) => traduzir(texto, authz.idioma ?? IDIOMA_PADRAO);

  let input;
  try {
    input = await validateRequest(openConversationWithContactSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  try {
    const admin = createAdminClient();
    // ia.vek v1.9.19.1: abrir conversa exige enxergar o contato; a chave de serviço não confere.
    const jaExiste = await contatoExistenteDaAbertura(admin, authz.organizationId, input);
    if (jaExiste && !(await contatoNoAlcance(authz.supabase, authz.organizationId, jaExiste))) {
      return fail("not_found", t("Contato não encontrado."), 404, { requestId });
    }
    const result = await openSharedContactConversation(admin, authz.organizationId, input)
    // Contato novo aberto por uma pessoa fica registrado como criado por ela.
    if (!jaExiste && authz.actor.type === "user") {
      await admin
        .from("contacts")
        .update({ created_by_user_id: authz.actor.id })
        .eq("id", result.contact_id)
        .eq("organization_id", authz.organizationId)
        .is("created_by_user_id", null);
    };
    return ok(result, { requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "open_failed";
    if (msg === "contact_not_found") {
      return fail("not_found", t("Contato não encontrado."), 404, { requestId });
    }
    if (msg === "session_not_found") {
      return fail("not_found", t("Sessão de canal não encontrada."), 404, { requestId });
    }
    if (msg === "invalid_phone") {
      return fail("validation_error", t("Telefone inválido."), 422, { requestId });
    }
    if (msg === "contact_personal") {
      return fail("forbidden", t("Contato marcado como pessoal."), 403, { requestId });
    }
    return fail("internal_error", msg, 500, { requestId });
  }
}
