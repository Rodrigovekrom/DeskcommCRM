/** PATCH /api/v1/iavek/orientacoes/[id] — marca a revisão semanal (gerente e admin; ia.vek v1.9.13). */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { traduzir } from "@/lib/i18n/dicionario";
import { revisaoSchema } from "@/lib/iavek/canal-da-ia";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "iavek_orientacoes_da_ia" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const corpo = revisaoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", traduzir("Revisão inválida.", authz.user.idioma), 422, { requestId });
  const db = await createClient();
  const { data, error } = await db.rpc("fn_iavek_revisar_orientacao", {
    p_org: authz.org.orgId,
    p_id: id,
    p_revisao: corpo.data.revisao,
  });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", traduzir("Orientação não encontrada.", authz.user.idioma), 404, { requestId });
  void audit({
    action: "ai_orientation.reviewed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "iavek_orientacao",
    resourceId: id,
    requestId,
    metadata: { revisao: corpo.data.revisao },
  });
  return ok({ id, revisao: corpo.data.revisao }, { requestId });
}
