/**
 * GET /api/v1/iavek/padrao/fora — ia.vek v1.8.0 (A2). Gerente e admin.
 *
 * "Fora do padrão" por vendedor: quais leads abertos têm item VENCIDO, e quais
 * itens. Só nomes de lead e de item — nenhum texto de conversa, nenhuma
 * mensagem, nenhuma sugestão. Padrão desligado: lista vazia.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { avaliarLeads, carregarPadrao, COLUNAS_DO_LEAD_DO_PADRAO, type LeadDoPadrao } from "@/lib/iavek/padrao-da-loja-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const admin = createAdminClient();
  const padrao = await carregarPadrao(admin, authz.org.orgId);
  if (!padrao.ativo) return ok({ ativo: false, vendedores: [] }, { requestId });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_leads")
    .select(COLUNAS_DO_LEAD_DO_PADRAO)
    .eq("organization_id", authz.org.orgId)
    .eq("status", "open")
    .not("owner_user_id", "is", null)
    .limit(1000);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const leads = (data ?? []) as LeadDoPadrao[];
  const avaliados = await avaliarLeads(admin, authz.org.orgId, padrao, leads);

  const porVendedor = new Map<string, Array<{ lead_id: string; titulo: string; itens: string[] }>>();
  for (const l of leads) {
    const a = avaliados.get(l.id);
    if (!a || a.fora === 0 || !l.owner_user_id) continue;
    const lista = porVendedor.get(l.owner_user_id) ?? [];
    lista.push({ lead_id: l.id, titulo: l.title, itens: a.itens.filter((i) => i.situacao === "fora_do_padrao").map((i) => i.nome) });
    porVendedor.set(l.owner_user_id, lista);
  }
  const nomes = await nomesDosAtendentes([...porVendedor.keys()]);
  return ok(
    {
      ativo: true,
      vendedores: [...porVendedor.entries()]
        .map(([id, lista]) => ({ vendedor_id: id, nome: nomes.get(id) ?? null, leads: lista }))
        .sort((a, b) => b.leads.length - a.leads.length),
    },
    { requestId },
  );
}
