/**
 * POST /api/v1/iavek/esteira/manter — ia.vek v1.9.23. Corpo: `{ lead_id }`.
 *
 * "Manter em negociação" (Rodrigo, 05/11): segura o lead nas 72h por mais 72h corridas a
 * partir de agora, e pode ser renovado. Quem pode: o dono do lead, o guardião, gerente e admin.
 * Só vale para lead aberto no funil de entrada, fora das colunas de compromisso (onde há relógio).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { cronometroDoLead, entradaDaEsteira } from "@/lib/iavek/cronometro-72h";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HORA = 3_600_000;
const corpoSchema = z.object({ lead_id: z.uuid() }).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;
  const eu = authz.user.id;
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });

  // Pela SESSÃO: lead que a pessoa não enxerga, para ela, não existe.
  const supabase = await createClient();
  const { data: lead, error } = await supabase
    .from("crm_leads")
    .select("id, status, pipeline_id, stage_id, created_at, source_metadata, owner_user_id, sdr_user_id")
    .eq("organization_id", orgId)
    .eq("id", corpo.data.lead_id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!lead) return fail("not_found", t("Lead não encontrado."), 404, { requestId });

  const pode =
    lead.owner_user_id === eu ||
    lead.sdr_user_id === eu ||
    authz.org.role === "manager" ||
    authz.org.role === "admin";
  if (!pode) return fail("forbidden", t("Só o dono do lead, o guardião, o gerente ou o admin mantêm em negociação."), 403, { requestId });

  const admin = createAdminClient();
  const { data: org, error: eOrg } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (eOrg) return fail("internal_error", eOrg.message, 500, { requestId });
  const entrada = entradaDaEsteira(org?.settings ?? null);
  if (!cronometroDoLead(lead, entrada)) {
    return fail("state_conflict", t("Este lead não está nas 72h."), 409, { requestId });
  }

  const ate = new Date(Date.now() + (entrada?.horas ?? 72) * HORA).toISOString();
  const metadata = { ...((lead.source_metadata as Record<string, unknown> | null) ?? {}), esteira_manter_ate: ate };
  const { error: eUpd } = await admin
    .from("crm_leads")
    .update({ source_metadata: metadata })
    .eq("organization_id", orgId)
    .eq("id", lead.id)
    .eq("status", "open");
  if (eUpd) return fail("internal_error", eUpd.message, 500, { requestId });

  void audit({
    action: "iavek.lead_mantido_em_negociacao",
    actorUserId: eu,
    organizationId: orgId,
    resourceType: "crm_leads",
    resourceId: lead.id,
    requestId,
    metadata: { ate },
  });
  return ok({ lead_id: lead.id, mantido_ate: ate }, { requestId });
}
