/**
 * POST /api/v1/iavek/comunicados/[id]/li — o "li e entendi" (ia.vek CRM-439, 0651).
 *
 * Pelo cliente da SESSÃO: `fn_iavek_li_e_entendi` é INVOKER, então a RLS vale. Grava a leitura da própria pessoa e
 * marca como lido o aviso dela no sino, numa chamada só. Idempotente: ler de novo devolve a mesma hora.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "iavek_comunicados_lidos" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success)
    return fail("not_found", t("Comunicado não encontrado."), 404, { requestId });
  const db = await createClient();
  const { data, error } = await db.rpc("fn_iavek_li_e_entendi", { p_comunicado: id });
  if (error) {
    if (error.code === "PT404")
      return fail("not_found", t("Comunicado não encontrado."), 404, { requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }
  void audit({
    action: "iavek.comunicado_lido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "iavek_comunicado",
    resourceId: id,
    requestId,
  });
  return ok({ id, lida_em: (data as string | null) ?? null }, { requestId });
}
