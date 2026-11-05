/**
 * GET /api/v1/iavek/relatorios/carros-anunciados?dias=30 — ia.vek v1.9.24 (CRM-195).
 *
 * Leads, vendas e valor vendido por CARRO DO ANÚNCIO, dos leads criados nos últimos `dias`.
 * Gerente e admin. Pela sessão (a RLS decide o que entra), por páginas: sem corte em 1000.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { CAMPO_CARRO_DO_ANUNCIO, relatorioPorCarroDoAnuncio } from "@/lib/iavek/carro-do-anuncio";
import { lerTudo } from "@/lib/supabase/paginas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({ dias: z.coerce.number().int().min(1).max(365).default(30) });

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const q = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) return fail("validation_failed", "dias inválido", 422, { requestId });
  const desde = new Date(Date.now() - q.data.dias * 86_400_000).toISOString();

  const supabase = await createClient();
  const { data, error } = await lerTudo<{ custom_fields: unknown; status: string; value_cents: number | null }>(
    (de, ate) =>
      supabase
        .from("crm_leads")
        .select("custom_fields, status, value_cents")
        .eq("organization_id", authz.org.orgId)
        .gte("created_at", desde)
        .not(`custom_fields->>${CAMPO_CARRO_DO_ANUNCIO}`, "is", null)
        .order("id")
        .range(de, ate),
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const linhas = relatorioPorCarroDoAnuncio(data);
  return ok({ dias: q.data.dias, total_leads: data.length, linhas }, { requestId });
}
