/**
 * ia.vek v1.5: o que a Entrada de leads precisa saber do contato para o
 * cronômetro das 72h e para o próximo passo obrigatório, numa leitura só:
 *
 *   - `lead`: o negócio ABERTO mais recente do contato (o do funil de entrada da
 *     esteira, quando houver);
 *   - `cronometro`: o prazo das primeiras 72h desse lead, ou null;
 *   - `proximo_passo`: a tarefa aberta de próximo passo (`crm_tasks`,
 *     `source_kind = 'proximo_passo'`) mais próxima, ou null.
 *
 * Só leitura. O contato é autorizado pela RLS (cliente da sessão); as
 * configurações da organização são lidas com o admin client, filtradas pela
 * organização ATIVA de quem chama (nunca por parâmetro).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { cronometroDoLead, entradaDaEsteira } from "@/lib/iavek/cronometro-72h";
import { SOURCE_KIND_PROXIMO_PASSO } from "@/lib/iavek/proximo-passo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "contacts" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id: contactId } = await ctx.params;

  const supabase = await createClient();
  const { data: contato, error: erroContato } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (erroContato) return fail("internal_error", erroContato.message, 500, { requestId });
  if (!contato) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  const [org, leads, passos] = await Promise.all([
    createAdminClient().from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    supabase
      .from("crm_leads")
      .select("id, title, status, pipeline_id, stage_id, created_at, updated_at")
      .eq("contact_id", contactId)
      .eq("organization_id", orgId)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase
      .from("crm_tasks")
      .select("id, title, due_date, status, assigned_to")
      .eq("contact_id", contactId)
      .eq("organization_id", orgId)
      .eq("source_kind", SOURCE_KIND_PROXIMO_PASSO)
      .in("status", ["pending", "in_progress"])
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(1),
  ]);
  const falha = org.error ?? leads.error ?? passos.error;
  if (falha) return fail("internal_error", falha.message, 500, { requestId });

  const entrada = entradaDaEsteira(org.data?.settings ?? null);
  const abertos = leads.data ?? [];
  // O lead do funil de entrada vem primeiro: é ele que tem o relógio.
  const lead =
    (entrada ? abertos.find((l) => l.pipeline_id === entrada.pipeline_id) : undefined) ??
    abertos[0] ??
    null;

  return ok(
    {
      lead: lead ? { id: lead.id, title: lead.title, pipeline_id: lead.pipeline_id } : null,
      cronometro: cronometroDoLead(lead, entrada),
      proximo_passo: passos.data?.[0] ?? null,
    },
    { requestId },
  );
}
