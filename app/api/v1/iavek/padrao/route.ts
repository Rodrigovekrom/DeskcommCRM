/**
 * /api/v1/iavek/padrao — ia.vek v1.8.0 (padrão da loja).
 * GET   o padrão em vigor (quem atende precisa ver o checklist).
 * PATCH `{ ativo, itens }` — SÓ o admin liga/desliga e define os itens.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { comPadraoDaLoja, lerPadraoDaLoja, padraoDaLojaSchema } from "@/lib/iavek/padrao-da-loja";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const { data } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  return ok(lerPadraoDaLoja(data?.settings), { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "organizations" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);
  const corpo = padraoDaLojaSchema.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return fail("validation_failed", t("Padrão da loja inválido."), 422, { requestId });
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  const { error } = await admin
    .from("organizations")
    .update({ settings: comPadraoDaLoja(org?.settings, corpo.data) })
    .eq("id", authz.org.orgId);
  if (error) return fail("internal_error", t("Não consegui gravar a configuração."), 500, { requestId });
  void audit({
    action: "iavek.padrao_da_loja_changed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "organizations",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { ativo: corpo.data.ativo, itens: corpo.data.itens.map((i) => i.id) },
  });
  return ok(corpo.data, { requestId });
}
