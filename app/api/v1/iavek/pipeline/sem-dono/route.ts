/**
 * GET /api/v1/iavek/pipeline/sem-dono?pipeline_id=… — ia.vek v1.7.7.
 *
 * A faixa "Chegaram agora — sem dono" do Pipeline do vendedor: os leads ABERTOS
 * do funil que ainda não têm dono (nem pessoa, nem agente), os mais novos
 * primeiro, com o total. Lê pela SESSÃO: quem não enxerga lead sem dono
 * (`visibility_mode = own`) recebe a lista vazia — a RLS decide, não a rota.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIMITE = 30;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const pipelineId = req.nextUrl.searchParams.get("pipeline_id");
  if (!z.uuid().safeParse(pipelineId).success) {
    return fail("validation_failed", t("Funil inválido."), 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("crm_leads")
    .select("id, title, created_at, stage_id, contact_id, contacts(name, display_name, phone_number)", {
      count: "exact",
    })
    .eq("organization_id", authz.org.orgId)
    .eq("pipeline_id", pipelineId!)
    .eq("status", "open")
    .is("owner_user_id", null)
    .is("owner_agent_id", null)
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  type Linha = { id: string; title: string; created_at: string; stage_id: string; contact_id: string | null; contacts?: unknown };
  const itens = ((data ?? []) as unknown as Linha[]).map((l) => {
    const contato = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as
      | { name: string | null; display_name: string | null; phone_number: string | null }
      | null
      | undefined;
    return {
      id: l.id,
      titulo: l.title,
      cliente: contato ? rotuloDoContato(contato, t) : null,
      chegou_em: l.created_at,
      stage_id: l.stage_id,
    };
  });
  return ok({ total: count ?? itens.length, itens }, { requestId });
}
