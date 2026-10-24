/**
 * GET /api/v1/iavek/obrigatorios/leads?ids=a,b,c — ia.vek v1.8.2.
 * O que falta em cada lead (selo "Incompleto" no cartão e na conversa). Lê pela
 * SESSÃO: a função do banco só responde pelos leads da organização de quem
 * pergunta, e a RLS dos leads decide quais existem para a pessoa.
 * Interruptor desligado: `{ ativo: false, leads: {} }`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerConfigDosObrigatorios } from "@/lib/iavek/campos-obrigatorios";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { data: org } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (!lerConfigDosObrigatorios(org?.settings).ativo) return ok({ ativo: false, leads: {} }, { requestId });

  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((i) => z.uuid().safeParse(i).success).slice(0, 500);
  if (ids.length === 0) return ok({ ativo: true, leads: {} }, { requestId });
  const supabase = await createClient();
  // Só os que a pessoa enxerga (RLS), e só então o banco diz o que falta.
  const { data: visiveis, error: e1 } = await supabase.from("crm_leads").select("id").eq("organization_id", authz.org.orgId).in("id", ids);
  if (e1) return fail("internal_error", e1.message, 500, { requestId });
  const alvo = (visiveis ?? []).map((l) => (l as { id: string }).id);
  if (alvo.length === 0) return ok({ ativo: true, leads: {} }, { requestId });
  const { data, error } = await supabase.rpc("fn_iavek_campos_que_faltam", { p_lead_ids: alvo });
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const leads = Object.fromEntries(((data ?? []) as Array<{ lead_id: string; faltam: string[] | null }>).map((r) => [r.lead_id, r.faltam ?? []]));
  return ok({ ativo: true, leads }, { requestId });
}
