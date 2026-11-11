/**
 * GET /api/v1/iavek/obrigatorios/incompletos — ia.vek v1.8.2. Gerente e admin.
 *
 * "Leads incompletos" no Meu dia: por vendedor, os leads ABERTOS a que falta
 * algum dos campos obrigatórios, e quais. Só nomes de lead e de campo — nenhum
 * texto de conversa. Interruptor desligado: lista vazia.
 */
import { randomUUID } from "node:crypto";
import { lerTudo } from "@/lib/supabase/paginas";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { lerConfigDosObrigatorios } from "@/lib/iavek/campos-obrigatorios";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

/** ia.vek v1.9.44: leads por chamada do rpc (abaixo do corte do servidor). */
const LOTE_DO_RPC = 1000;

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const { data: org } = await createAdminClient().from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (!lerConfigDosObrigatorios(org?.settings).ativo) return ok({ ativo: false, vendedores: [] }, { requestId });

  const supabase = await createClient();
  const { data: leads, error } = await lerTudo<{ id: string; title: string; owner_user_id: string }>((de, ate) =>
    supabase
      .from("crm_leads")
      .select("id, title, owner_user_id")
      .eq("organization_id", authz.org.orgId)
      .eq("status", "open")
      .not("owner_user_id", "is", null)
      .order("id")
      .range(de, ate),
  );
  if (error) return fail("internal_error", error.message, 500, { requestId });
  const lista = (leads ?? []) as Array<{ id: string; title: string; owner_user_id: string }>;
  if (lista.length === 0) return ok({ ativo: true, vendedores: [] }, { requestId });
  // ia.vek v1.9.44 (Lupa): a saída do rpc também passa pelo corte do servidor (3.000 na produção).
  // Com todos os leads numa chamada, quem ficasse de fora da resposta contava como COMPLETO. Em lotes
  // de LOTE_DO_RPC, cada resposta fica abaixo do corte.
  const faltam = new Map<string, string[]>();
  for (let i = 0; i < lista.length; i += LOTE_DO_RPC) {
    const lote = lista.slice(i, i + LOTE_DO_RPC).map((l) => l.id);
    const { data: faltas, error: e2 } = await supabase.rpc("fn_iavek_campos_que_faltam", { p_lead_ids: lote });
    if (e2) return fail("internal_error", e2.message, 500, { requestId });
    for (const r of (faltas ?? []) as Array<{ lead_id: string; faltam: string[] | null }>) faltam.set(r.lead_id, r.faltam ?? []);
  }

  const porVendedor = new Map<string, Array<{ lead_id: string; titulo: string; faltam: string[] }>>();
  for (const l of lista) {
    const f = faltam.get(l.id) ?? [];
    if (f.length === 0) continue;
    const linha = porVendedor.get(l.owner_user_id) ?? [];
    linha.push({ lead_id: l.id, titulo: l.title, faltam: f });
    porVendedor.set(l.owner_user_id, linha);
  }
  const nomes = await nomesDosAtendentes([...porVendedor.keys()]);
  return ok(
    {
      ativo: true,
      vendedores: [...porVendedor.entries()]
        .map(([id, ls]) => ({ vendedor_id: id, nome: nomes.get(id) ?? null, leads: ls }))
        .sort((a, b) => b.leads.length - a.leads.length),
    },
    { requestId },
  );
}
