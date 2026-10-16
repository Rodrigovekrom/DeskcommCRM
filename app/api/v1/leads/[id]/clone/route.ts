import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/leads/[id]/clone — levar o negócio para OUTRO funil.
 *
 * É o caminho que a P-01 manda usar quando o alvo é outro funil: `/move` recusa
 * (422 `pipeline_immutable_use_clone`) e aponta para cá. Antes desta rota o
 * apontamento não existia em lugar nenhum do produto.
 *
 * A troca são DUAS escritas, nesta ordem de propósito:
 *  1. cria o clone no funil destino (via `createLeadHandler` — a MESMA porta da
 *     criação normal: valida etapa↔funil, calcula posição, aplica a regra de dono,
 *     emite `lead.created` e grava audit);
 *  2. encerra a origem via `encerraDemanda` com motivo canônico (P-03).
 *
 * A ordem é "clone primeiro" porque o banco não tem transação entre as duas: se a
 * segunda falhar, existe um negócio a mais no funil destino (visível, corrigível)
 * e a origem continua aberta. Na ordem inversa, uma falha na criação deixaria a
 * origem PERDIDA e sem sucessor — o operador perderia o negócio sem ver para onde
 * ele foi. A rota devolve 500 nesse caso, sem esconder a meia-execução.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { listPipelinesHandler } from "@/app/api/v1/pipelines/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { cloneLeadSchema, validateRequest } from "@/lib/schemas";
import { clonarLeadParaFunil } from "@/lib/leads/clonar-lead-para-funil";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/leads/[id]/clone — para ONDE este negócio pode ir.
 *
 * Exceção deliberada e MÍNIMA à matriz spec 13 §4 (pipelines read = manager+,
 * `GET /api/v1/pipelines`): quem vai clicar em "Levar para outro funil" precisa
 * escolher o destino, e `pipeline.move_card` (a MESMA permissão que já autoriza
 * o POST abaixo) já é `agent`+ — negar a leitura aqui só empurraria o mesmo dado
 * por um caminho sem gate nenhum. Payload mínimo: `id` e `name`, nunca
 * `settings`/`description` (isso é configuração, fica atrás de `manager` na rota
 * de gestão). O funil ATUAL do lead sai da lista — não é destino válido de troca
 * (a mesma regra de `recusaTrocaDeFunil`, medida aqui em vez de deixar a tela
 * descobrir só ao tentar).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { data: origem, error: selErr } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id")
    .eq("id", leadId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (selErr) return fail("internal_error", selErr.message, 500, { requestId });
  if (!origem) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  const { pipelines } = await listPipelinesHandler(supabase, {
    organization_id: authz.org.orgId,
    actor: { type: "user", id: authz.user.id },
    requestId,
  });

  const destinos = pipelines
    .filter((p) => p.id !== (origem as { pipeline_id: string }).pipeline_id)
    .map((p) => ({ id: p.id, name: p.name }));

  return ok({ pipelines: destinos }, { requestId });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id: leadId } = await ctx.params;

  const supabase = await createClient();
  // spec 13 §4: escrita é agent+ (viewer é read-only).
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;

  const handlerCtx: HandlerCtx = {
    organization_id: authz.org.orgId,
    actor: { type: "user", id: authz.user.id },
    requestId,
    idioma: authz.user.idioma,
  };

  try {
    const input = await validateRequest(cloneLeadSchema, req);
    const r = await clonarLeadParaFunil(supabase, handlerCtx, leadId, input);
    if (!r.ok) {
      return fail(r.code, r.message, r.status, {
        ...(r.details ? { details: r.details } : {}),
        requestId,
      });
    }
    // 201 e não 200: a rota CRIA um recurso, como `POST /api/v1/leads`
    // (app/api/v1/leads/route.ts). Duas criações irmãs com códigos diferentes
    // fazem quem integra tratar cada uma de um jeito sem que nada justifique.
    return ok({ lead: r.clone, origem: r.origem }, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
}
