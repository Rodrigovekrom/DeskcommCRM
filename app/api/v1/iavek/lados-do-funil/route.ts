/**
 * /api/v1/iavek/lados-do-funil — ia.vek v1.9.3 (o Pipeline por função).
 * GET   as etapas do funil PADRÃO e o lado de cada uma (SDR, vendedor, ambos
 *       ou nenhum) — gerente e admin.
 * PATCH `{ pipeline_id, lados: { <stage_id>: "sdr"|"vendedor"|"ambos" } }` —
 *       SÓ o admin. Etapa fora do mapa não aparece no Pipeline de quem tem
 *       função; mapa vazio desliga o recorte (todos veem todas as etapas).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { comLados, ladosSchema, lerLados } from "@/lib/iavek/lados-do-funil";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ pipeline_id: z.string().uuid(), lados: ladosSchema });

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const { data: funil } = await admin
    .from("crm_pipelines")
    .select("id, name, settings")
    .eq("organization_id", authz.org.orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (!funil) return ok({ funil: null, etapas: [] }, { requestId });
  const { data: etapas } = await admin
    .from("crm_stages")
    .select("id, name, position")
    .eq("organization_id", authz.org.orgId)
    .eq("pipeline_id", funil.id)
    .eq("is_archived", false)
    .order("position");
  const lados = lerLados(funil.settings);
  return ok(
    {
      funil: { id: funil.id, name: funil.name },
      etapas: (etapas ?? []).map((e) => ({ id: e.id, name: e.name, lado: lados[e.id as string] ?? null })),
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "crm_pipelines" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Configuração inválida."), 422, { requestId });
  const admin = createAdminClient();
  const { data: funil } = await admin
    .from("crm_pipelines")
    .select("id, settings")
    .eq("organization_id", authz.org.orgId)
    .eq("id", corpo.data.pipeline_id)
    .maybeSingle();
  if (!funil) return fail("not_found", t("Funil não encontrado."), 404, { requestId });
  const ids = Object.keys(corpo.data.lados);
  if (ids.length > 0) {
    const { data: etapas } = await admin
      .from("crm_stages")
      .select("id")
      .eq("organization_id", authz.org.orgId)
      .eq("pipeline_id", funil.id)
      .in("id", ids);
    if ((etapas ?? []).length !== ids.length) {
      return fail("validation_failed", t("Há etapa que não é deste funil."), 422, { requestId });
    }
  }
  const antes = lerLados(funil.settings);
  const { error } = await admin
    .from("crm_pipelines")
    .update({ settings: comLados(funil.settings, corpo.data.lados) })
    .eq("organization_id", authz.org.orgId)
    .eq("id", funil.id);
  if (error) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });
  void audit({
    action: "iavek.lados_do_funil_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "crm_pipelines",
    resourceId: funil.id,
    requestId,
    metadata: { antes, depois: corpo.data.lados },
  });
  return ok({ pipeline_id: funil.id, lados: corpo.data.lados }, { requestId });
}
