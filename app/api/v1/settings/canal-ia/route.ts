/** GET/PATCH /api/v1/settings/canal-ia — a chave do canal de orientação da IA (ia.vek v1.9.13). Desligada por padrão. */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { canalDaIaAtivo, canalSchema, comCanalDaIa } from "@/lib/iavek/canal-da-ia";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_canal_ia" });
  if (!authz.ok) return authz.response;
  const db = await createClient();
  const { data, error } = await db.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok({ ativo: canalDaIaAtivo(data?.settings) }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const negado = await requireSupportWrite();
  if (negado) return negado;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "settings_canal_ia" });
  if (!authz.ok) return authz.response;
  const corpo = canalSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", "Envie { ativo: boolean }.", 422, { requestId });
  const db = await createClient();
  const { data: org, error } = await db.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (error || !org) return fail("internal_error", error?.message ?? "organização não lida", 500, { requestId });
  // Como no Altimus: a escrita da chave é da rota (admin confirmado acima), filtrada pela org.
  const { error: erroGravar } = await createAdminClient()
    .from("organizations")
    .update({ settings: comCanalDaIa(org.settings, corpo.data.ativo) })
    .eq("id", authz.org.orgId);
  if (erroGravar) return fail("internal_error", erroGravar.message, 500, { requestId });
  void audit({
    action: "settings.canal_ia_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { ativo: corpo.data.ativo },
  });
  return ok({ ativo: corpo.data.ativo }, { requestId });
}
