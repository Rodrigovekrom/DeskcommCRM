/**
 * GET /api/v1/iavek/compra-futura/vencidas — ia.vek v1.9.45 (CRM-294, condição 3 do Maestro).
 *
 * Os leads em Compra futura cujo MÊS PREVISTO JÁ PASSOU e ninguém agiu. Só com o interruptor faixa_vencida (desligado
 * de fábrica desde 11/11). Leads sem mês nunca entram. Eles NÃO voltam sozinhos a
 * aberto: aparecem aqui, para o gerente decidir (reabrir, mudar o mês, ou perder com motivo).
 */
import { compraFuturaLigada } from "@/lib/iavek/compra-futura/interruptores";
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { traduzir } from "@/lib/i18n/dicionario";
import { inicioDoMesAtual } from "@/lib/iavek/compra-futura/rodada";
import { createClient } from "@/lib/supabase/server";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

export const dynamic = "force-dynamic";

const LIMITE = 50;

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const supabase = await createClient();
  // Desde 11/11 (Rodrigo simplificou), a faixa só existe com o interruptor ligado; desligada, a tela não mostra nada.
  const { data: org } = await supabase.from("organizations").select("settings").eq("id", authz.org.orgId).maybeSingle();
  if (!compraFuturaLigada((org as { settings?: unknown } | null)?.settings, "faixa_vencida")) {
    return ok({ ativo: false, total: 0, itens: [] }, { requestId });
  }
  const { data, error, count } = await supabase
    .from("crm_leads")
    .select("id, title, pipeline_id, compra_futura_mes, compra_futura_vendedor_id, contacts(name, display_name, phone_number)", { count: "exact" })
    .eq("organization_id", authz.org.orgId)
    .eq("status", "future")
    .lt("compra_futura_mes", inicioDoMesAtual())
    .order("compra_futura_mes", { ascending: true })
    .limit(LIMITE);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  type Linha = { id: string; title: string; pipeline_id: string; compra_futura_mes: string; compra_futura_vendedor_id: string | null; contacts?: unknown };
  const linhas = (data ?? []) as unknown as Linha[];
  const nomes = await nomesDosAtendentes([...new Set(linhas.map((l) => l.compra_futura_vendedor_id).filter((v): v is string => !!v))]);
  const itens = linhas.map((l) => {
    const contato = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as
      | { name: string | null; display_name: string | null; phone_number: string | null }
      | null
      | undefined;
    return {
      id: l.id,
      titulo: l.title,
      pipeline_id: l.pipeline_id,
      cliente: contato ? rotuloDoContato(contato, t) : null,
      mes: l.compra_futura_mes,
      vendedor: l.compra_futura_vendedor_id ? (nomes.get(l.compra_futura_vendedor_id) ?? null) : null,
    };
  });
  return ok({ ativo: true, total: count ?? itens.length, itens }, { requestId });
}
