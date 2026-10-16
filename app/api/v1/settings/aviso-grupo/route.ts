/**
 * GET/PATCH /api/v1/settings/aviso-grupo — o grupo do WhatsApp da EQUIPE que
 * recebe os avisos das automações (ia.vek D4), o número que envia, o
 * espaçamento e o teto diário. Mora em `organizations.settings.aviso_grupo`.
 * Ler: gestor; gravar: admin. `null` no PATCH desliga (remove a chave).
 *
 * O grupo precisa ser um dos grupos CONHECIDOS daquele número
 * (`channel_session_groups`): nada de id digitado à mão apontando para um grupo
 * de outra organização.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { avisoGrupoSettingsSchema, configDoAvisoGrupo } from "@/lib/avisos-grupo/regras";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "settings_aviso_grupo" });
  if (!authz.ok) return authz.response;
  const { data } = await createAdminClient()
    .from("organizations")
    .select("settings")
    .eq("id", authz.org.orgId)
    .maybeSingle();
  return ok({ aviso_grupo: configDoAvisoGrupo((data as { settings?: unknown } | null)?.settings) }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "settings_aviso_grupo" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const corpo = (await req.json().catch(() => undefined)) as unknown;
  const admin = createAdminClient();

  let novo: ReturnType<typeof avisoGrupoSettingsSchema.parse> | null = null;
  if (corpo !== null) {
    const parsed = avisoGrupoSettingsSchema.safeParse(corpo);
    if (!parsed.success) {
      return fail("validation_error", parsed.error.issues[0]?.message ?? "Configuração inválida.", 422, { requestId });
    }
    const { data: grupo } = await admin
      .from("channel_session_groups")
      .select("subject")
      .eq("organization_id", orgId)
      .eq("channel_session_id", parsed.data.channel_session_id)
      .eq("group_chat_id", parsed.data.group_chat_id)
      .maybeSingle();
    if (!grupo) {
      return fail("validation_error", "Esse grupo não é conhecido neste número. Liste os grupos em Conexões › Grupos.", 422, {
        requestId,
      });
    }
    novo = { ...parsed.data, group_subject: (grupo as { subject?: string | null }).subject ?? undefined };
  }

  const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const atuais = ((orgRow as { settings?: Record<string, unknown> | null } | null)?.settings ?? {}) as Record<string, unknown>;
  const { aviso_grupo: _antigo, ...resto } = atuais;
  const proximo = novo === null ? resto : { ...resto, aviso_grupo: novo };
  const { error } = await admin.from("organizations").update({ settings: proximo }).eq("id", orgId);
  if (error) return fail("internal_error", "Não deu para salvar.", 500, { requestId });

  void audit({
    action: "aviso_grupo.config_changed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "organization",
    resourceId: orgId,
    requestId,
    metadata: { ligado: novo !== null, group_chat_id: novo?.group_chat_id ?? null },
  });
  return ok({ aviso_grupo: novo }, { requestId });
}
