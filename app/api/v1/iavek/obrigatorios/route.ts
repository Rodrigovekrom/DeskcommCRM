/**
 * /api/v1/iavek/obrigatorios — ia.vek v1.8.2 (campos obrigatórios).
 * GET   o interruptor em vigor (todos veem: o selo depende dele).
 * PATCH `{ ativo }` — SÓ o admin liga/desliga "Exigir campos obrigatórios".
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { comConfigDosObrigatorios, configDosObrigatoriosSchema, lerConfigDosObrigatorios } from "@/lib/iavek/campos-obrigatorios";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const { data } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  return ok(lerConfigDosObrigatorios(data?.settings), { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const corpo = configDosObrigatoriosSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Configuração inválida."), 422, { requestId });
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  const { error } = await admin
    .from("organizations")
    .update({ settings: comConfigDosObrigatorios(org?.settings, corpo.data) })
    .eq("id", authz.org.orgId);
  if (error) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });
  void audit({
    action: "iavek.campos_obrigatorios_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organizations",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { ativo: corpo.data.ativo },
  });
  return ok(corpo.data, { requestId });
}
