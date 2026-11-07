/**
 * GET /api/v1/conversations/[id]/media/video/[trabalho] — ia.vek CRM-258: o estado da conversão
 * ("encolhendo", "pronto" com o arquivo guardado, ou "falhou" com o motivo). Só quem pediu, na mesma
 * organização e conversa, vê.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { resolveAuthDual, tetoDeEscritaDoToken } from "@/lib/api/auth-dual";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
import { lerConversao } from "@/lib/iavek/video/fila-do-video";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string; trabalho: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id: conversationId, trabalho } = await ctx.params;
  const authz = await resolveAuthDual(req, { requestId, resource: "conversation_media", role: "agent", scope: "mcp:write" });
  if (!authz.ok) return authz.response;
  // Faz parte do ENVIO (escrita): o token que não pode escrever não acompanha o vídeo.
  const teto = await tetoDeEscritaDoToken(authz, "conversation_media", requestId);
  if (teto) return teto;
  const estado = lerConversao(trabalho, { org: authz.organizationId, conversationId, userId: authz.actor.id });
  if (!estado) {
    return fail("not_found", traduzir("O vídeo não está mais na fila (o servidor pode ter reiniciado). Envie de novo.", authz.idioma ?? IDIOMA_PADRAO), 404, { requestId });
  }
  return ok(estado, { requestId });
}
