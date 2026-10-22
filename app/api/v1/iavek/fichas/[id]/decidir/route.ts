/**
 * POST /api/v1/iavek/fichas/[id]/decidir — ia.vek v1.7.8. Analista ou admin.
 * Corpo: `{ status: "aprovada" | "recusada" | "pendente_documento", motivo? }`.
 * Recusada e pendente de documento exigem motivo. O vendedor é avisado na hora
 * (sino), SEM o motivo na notificação — ele o lê na ficha.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { quemNaFicha } from "@/lib/iavek/fichas";
import { avisar, lerFicha, semAcesso } from "@/lib/iavek/fichas-servidor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const corpoSchema = z
  .object({
    status: z.enum(["aprovada", "recusada", "pendente_documento"]),
    motivo: z.string().trim().max(1000).optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const t = (s: string) => traduzir(s, quem.idioma);
  const { id } = await ctx.params;
  if (!(quem.analista || quem.admin) || quem.suporteSoLeitura || !z.uuid().safeParse(id).success) {
    return semAcesso(quem, requestId);
  }
  const corpo = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Campos inválidos."), 422, { requestId });
  const motivo = corpo.data.motivo?.trim() || null;
  if (corpo.data.status !== "aprovada" && (!motivo || motivo.length < 3)) {
    return fail("validation_failed", t("Escreva o motivo (pelo menos 3 letras)."), 422, { requestId });
  }
  const ficha = await lerFicha(quem.orgId, id);
  if (!ficha) return semAcesso(quem, requestId);
  if (ficha.anonimizada) return fail("state_conflict", t("Esta ficha foi anonimizada."), 409, { requestId });

  const { error } = await createAdminClient()
    .from("iavek_fichas")
    .update({
      status: corpo.data.status,
      motivo,
      decidida_por: quem.userId,
      decidida_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", quem.orgId)
    .eq("id", id);
  if (error) return fail("internal_error", t("Não consegui gravar a decisão."), 500, { requestId });

  void avisar(
    quem.orgId,
    [ficha.enviada_por, ficha.dono_do_lead].filter((u): u is string => Boolean(u)),
    "ficha_decidida",
    ficha.lead_id,
    quem.userId,
    { status: corpo.data.status },
  );
  void audit({
    action: "iavek.ficha_decidida",
    actorUserId: quem.userId,
    organizationId: quem.orgId,
    resourceType: "iavek_fichas",
    resourceId: id,
    requestId,
    metadata: { status: corpo.data.status },
  });
  return ok({ id, status: corpo.data.status }, { requestId });
}
