/**
 * /api/v1/iavek/agenda-ia — ia.vek v1.9.2 (como a IA marca, no modo agendamento).
 * GET   o modo, a configuração em vigor e o prompt-base da clínica — gerente e admin.
 * PATCH `{ marca_como }` — SÓ o admin, e SÓ com a empresa no modo agendamento
 *       (fora dele a IA não marca: faz pedido, como na loja). Nasce pré-agendado.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { PROMPT_BASE_CLINICA, agendaDaIaSchema, comAgendaDaIa, lerAgendaDaIa } from "@/lib/iavek/agenda-da-ia";
import { lerPerfilDaEmpresa } from "@/lib/iavek/perfil-da-empresa";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const { data } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  const modo = lerPerfilDaEmpresa(data?.settings).modo_agendamento;
  return ok(
    { modo_agendamento: modo, config: lerAgendaDaIa(data?.settings), prompt_base: modo ? PROMPT_BASE_CLINICA : null },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const corpo = agendaDaIaSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Configuração inválida."), 422, { requestId });
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (!lerPerfilDaEmpresa(org?.settings).modo_agendamento) {
    return fail("state_conflict", t("A IA só marca na agenda com o modo agendamento ligado."), 409, { requestId });
  }
  const { error } = await admin
    .from("organizations")
    .update({ settings: comAgendaDaIa(org?.settings, corpo.data) })
    .eq("id", authz.org.orgId);
  if (error) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });
  void audit({
    action: "iavek.agenda_ia_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organizations",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { marca_como: corpo.data.marca_como },
  });
  return ok(corpo.data, { requestId });
}
