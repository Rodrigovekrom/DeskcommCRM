/**
 * /api/v1/iavek/nota-do-atendimento — ia.vek v1.8.4 (a chave da nota do atendimento).
 * GET   a chave em vigor — gerente e admin (só eles veem as notas).
 * PATCH `{ ativo }` — SÓ o admin liga/desliga. Nasce DESLIGADA.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { comConfigDaNota, configDaNotaSchema, lerConfigDaNota } from "@/lib/iavek/nota-do-atendimento";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const { data } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  return ok(lerConfigDaNota(data?.settings), { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const corpo = configDaNotaSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Configuração inválida."), 422, { requestId });
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  const { error } = await admin
    .from("organizations")
    .update({ settings: comConfigDaNota(org?.settings, corpo.data) })
    .eq("id", authz.org.orgId);
  if (error) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });
  void audit({
    action: "iavek.nota_do_atendimento_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organizations",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { ativo: corpo.data.ativo },
  });
  return ok(corpo.data, { requestId });
}
