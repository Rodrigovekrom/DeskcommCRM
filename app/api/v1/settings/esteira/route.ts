/**
 * GET/PATCH /api/v1/settings/esteira — configuração da esteira de vendas (ia.vek D3):
 * horário comercial, quem recebe a escalada de ligação vencida e o relatório
 * semanal (por PAPEL ou USUÁRIO, nunca nome fixo) e os prazos da escalada.
 * Mora em `organizations.settings.esteira`. Ler: gestor; gravar: admin.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { configDaEsteira, esteiraSettingsSchema } from "@/lib/esteira/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function lerSettings(orgId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await createAdminClient()
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (error) return null;
  return (data?.settings as Record<string, unknown> | null) ?? {};
}

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_esteira" });
  if (!authz.ok) return authz.response;
  const settings = await lerSettings(authz.org.orgId);
  if (settings === null) return fail("internal_error", "Não deu para ler a configuração.", 500, { requestId });
  return ok({ salvo: settings.esteira ?? {}, em_vigor: configDaEsteira(settings) }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "settings_esteira" });
  if (!authz.ok) return authz.response;

  const parsed = esteiraSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_error", "Configuração inválida.", 422, {
      requestId,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const atuais = await lerSettings(authz.org.orgId);
  if (atuais === null) return fail("internal_error", "Não deu para ler a configuração.", 500, { requestId });
  const proximo = { ...atuais, esteira: parsed.data };
  const { error } = await createAdminClient()
    .from("organizations")
    .update({ settings: proximo })
    .eq("id", authz.org.orgId);
  if (error) return fail("internal_error", "Não deu para salvar a configuração.", 500, { requestId });

  void audit({
    action: "esteira.config_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organization",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { esteira: parsed.data },
  });
  return ok({ salvo: parsed.data, em_vigor: configDaEsteira(proximo) }, { requestId });
}
