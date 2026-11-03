/**
 * GET /api/v1/iavek/cartao?pipeline_id= — ia.vek v1.9.5 (CRM-196).
 *
 * Para os cartões de um funil: quem é cada responsável e guardião (nome e
 * função na loja) e o objetivo atual de cada lead (o próximo passo em aberto).
 * Os leads são lidos com a SESSÃO (a RLS recorta o que a pessoa vê); nomes,
 * funções e tarefas, pelo servidor, sempre filtrando a organização.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { objetivosDosLeads, pessoasDosLeads } from "@/lib/iavek/responsavel-do-lead";
import { createAdminClient } from "@/lib/supabase/admin";
import { todasAsPaginas } from "@/lib/supabase/paginas";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const funil = req.nextUrl.searchParams.get("pipeline_id") ?? "";
  if (!z.uuid().safeParse(funil).success) return fail("validation_failed", "pipeline_id", 422, { requestId });
  const sessao = await createClient();
  // ia.vek v1.9.14: em páginas. Com corte em 1000, o cartão além do corte ficava sem responsável.
  type LinhaDoCartao = { id: string; owner_user_id: string | null; sdr_user_id: string | null };
  let leads: LinhaDoCartao[];
  try {
    leads = await todasAsPaginas<LinhaDoCartao>((de, ate) =>
      sessao
        .from("crm_leads")
        .select("id, owner_user_id, sdr_user_id")
        .eq("organization_id", authz.org.orgId)
        .eq("pipeline_id", funil)
        .eq("status", "open")
        .order("id")
        .range(de, ate) as never,
    );
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : String(erro), 500, { requestId });
  }
  const admin = createAdminClient();
  const [pessoas, objetivos] = await Promise.all([
    pessoasDosLeads(
      admin,
      authz.org.orgId,
      leads.flatMap((l) => [l.owner_user_id, l.sdr_user_id]).filter((x): x is string => Boolean(x)),
    ),
    objetivosDosLeads(admin, authz.org.orgId, leads.map((l) => l.id)),
  ]);
  return ok({ pessoas, objetivos }, { requestId });
}
