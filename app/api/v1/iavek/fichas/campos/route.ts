/**
 * /api/v1/iavek/fichas/campos — ia.vek v1.7.8.
 * GET   os campos da ficha em vigor (quem envia e quem analisa precisam vê-los).
 * PATCH `{ campos }` — só o admin muda a lista.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { camposDaFichaSchema, comCamposDaFicha, lerCamposDaFicha, quemNaFicha } from "@/lib/iavek/fichas";
import { semAcesso } from "@/lib/iavek/fichas-servidor";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  if (!quem.analista && (quem.role === null || quem.role === "viewer")) return semAcesso(quem, requestId);
  const { data } = await createAdminClient().from("organizations").select("settings").eq("id", quem.orgId).maybeSingle();
  return ok({ campos: lerCamposDaFicha(data?.settings) }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const quem = await quemNaFicha();
  if (!quem) return fail("unauthenticated", "Auth required.", 401, { requestId });
  if (!quem.admin || quem.suporteSoLeitura) return semAcesso(quem, requestId);
  const t = (s: string) => traduzir(s, quem.idioma);
  const corpo = await req.json().catch(() => null);
  const lido = camposDaFichaSchema.safeParse((corpo as { campos?: unknown } | null)?.campos);
  if (!lido.success) return fail("validation_failed", t("Lista de campos inválida."), 422, { requestId });
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("settings").eq("id", quem.orgId).maybeSingle();
  const { error } = await admin
    .from("organizations")
    .update({ settings: comCamposDaFicha(org?.settings, lido.data) })
    .eq("id", quem.orgId);
  if (error) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });
  void audit({
    action: "iavek.ficha_campos_changed",
    actorUserId: quem.userId,
    organizationId: quem.orgId,
    resourceType: "organizations",
    resourceId: quem.orgId,
    requestId,
    metadata: { chaves: lido.data.map((c) => c.key) },
  });
  return ok({ campos: lido.data }, { requestId });
}
