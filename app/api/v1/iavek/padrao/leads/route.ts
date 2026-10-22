/**
 * GET /api/v1/iavek/padrao/leads — ia.vek v1.8.0.
 *   ?ids=a,b,c                      os leads pedidos (o painel do atendimento);
 *   ?pipeline_id=…&escopo=carteira  a carteira de quem pede (selo do Pipeline).
 * Os leads são lidos pela SESSÃO (a RLS decide quais existem para a pessoa);
 * só então a contagem de mídia roda no servidor. Padrão desligado: `{}`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { avaliarLeads, carregarPadrao, COLUNAS_DO_LEAD_DO_PADRAO, type LeadDoPadrao } from "@/lib/iavek/padrao-da-loja-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const padrao = await carregarPadrao(admin, authz.org.orgId);
  if (!padrao.ativo) return ok({ ativo: false, leads: {} }, { requestId });

  const sp = req.nextUrl.searchParams;
  const supabase = await createClient();
  let consulta = supabase.from("crm_leads").select(COLUNAS_DO_LEAD_DO_PADRAO).eq("organization_id", authz.org.orgId).eq("status", "open");
  const ids = (sp.get("ids") ?? "").split(",").filter((i) => z.uuid().safeParse(i).success).slice(0, 50);
  const funil = sp.get("pipeline_id");
  if (ids.length > 0) consulta = consulta.in("id", ids);
  else if (funil && z.uuid().safeParse(funil).success && sp.get("escopo") === "carteira") {
    consulta = consulta.eq("pipeline_id", funil).eq("owner_user_id", authz.user.id).limit(500);
  } else return fail("validation_failed", "ids ou pipeline_id+escopo", 422, { requestId });

  const { data, error } = await consulta;
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const avaliados = await avaliarLeads(admin, authz.org.orgId, padrao, (data ?? []) as LeadDoPadrao[]);
  return ok({ ativo: true, leads: Object.fromEntries(avaliados) }, { requestId });
}
