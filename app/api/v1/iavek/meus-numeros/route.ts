/**
 * GET /api/v1/iavek/meus-numeros?periodo=hoje|7d|30d — ia.vek v1.9.3.
 *
 * Os números SÓ de quem está conectado: o filtro por pessoa é `authz.user.id`,
 * nunca um parâmetro — não existe como pedir os de outra pessoa. Service role
 * (contagens que atravessam tabelas), sempre filtrando a organização à mão.
 * O SDR vê os números de SDR; os demais, os de vendedor (`visaoDosNumeros`).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { funcaoDaTela } from "@/lib/iavek/funcoes";
import {
  ehPerdaDeVerdade,
  ehPeriodo,
  limitesDoPeriodo,
  topMotivos,
  visaoDosNumeros,
  type NumerosDoSdr,
  type NumerosDoVendedor,
} from "@/lib/iavek/meus-numeros";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "analytics" });
  if (!authz.ok) return authz.response;
  const bruto = req.nextUrl.searchParams.get("periodo") ?? "7d";
  const periodo = ehPeriodo(bruto) ? bruto : "7d";
  const orgId = authz.org.orgId;
  const eu = authz.user.id;
  const { inicio, fim } = limitesDoPeriodo(periodo, new Date(), authz.org.timezone ?? "America/Sao_Paulo");
  const de = inicio.toISOString();
  const ate = fim.toISOString();
  const db = createAdminClient();
  const visao = visaoDosNumeros(funcaoDaTela(authz.org.interface_settings?.funcao));

  const contar = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const leads = () => db.from("crm_leads").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  const compromissos = () =>
    db.from("calendar_appointments").select("id", { count: "exact", head: true }).eq("organization_id", orgId);

  try {
    if (visao === "sdr") {
      const meus = `owner_user_id.eq.${eu},sdr_user_id.eq.${eu}`;
      const [leadsComigo, chamadas, tarefasDeLigacao, marcados, pedidos, confirmados, vieram, faltaram, vendidos] =
        await Promise.all([
          contar(leads().eq("status", "open").or(meus)),
          contar(
            db
              .from("voice_calls")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .eq("created_by", eu)
              .gte("created_at", de)
              .lt("created_at", ate),
          ),
          contar(
            db
              .from("crm_tasks")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .eq("assigned_to", eu)
              .eq("status", "done")
              .like("source_kind", "ligacao:%")
              .gte("updated_at", de)
              .lt("updated_at", ate),
          ),
          contar(compromissos().eq("created_by_user_id", eu).neq("status", "cancelled").gte("created_at", de).lt("created_at", ate)),
          contar(
            db
              .from("iavek_pedidos_de_agendamento")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .eq("pedido_por", eu)
              .gte("created_at", de)
              .lt("created_at", ate),
          ),
          contar(
            db
              .from("iavek_pedidos_de_agendamento")
              .select("id", { count: "exact", head: true })
              .eq("organization_id", orgId)
              .eq("pedido_por", eu)
              .eq("status", "confirmado")
              .gte("created_at", de)
              .lt("created_at", ate),
          ),
          contar(compromissos().eq("created_by_user_id", eu).eq("status", "completed").gte("starts_at", de).lt("starts_at", ate)),
          contar(compromissos().eq("created_by_user_id", eu).eq("status", "no_show").gte("starts_at", de).lt("starts_at", ate)),
          contar(leads().eq("status", "won").or(meus).gte("closed_at", de).lt("closed_at", ate)),
        ]);
      const numeros: NumerosDoSdr = {
        visao: "sdr",
        leads_comigo: leadsComigo,
        ligacoes: chamadas + tarefasDeLigacao,
        agendamentos_marcados: marcados,
        pedidos_feitos: pedidos,
        pedidos_confirmados: confirmados,
        compareceram: vieram,
        nao_vieram: faltaram,
        vendidos,
      };
      return ok({ periodo, de, ate, numeros }, { requestId });
    }

    const [carteira, agendamentos, vieram, faltaram, propostas, ganhos, perdidos] = await Promise.all([
      contar(leads().eq("status", "open").eq("owner_user_id", eu)),
      contar(compromissos().eq("owner_user_id", eu).neq("status", "cancelled").gte("starts_at", de).lt("starts_at", ate)),
      contar(compromissos().eq("owner_user_id", eu).eq("status", "completed").gte("starts_at", de).lt("starts_at", ate)),
      contar(compromissos().eq("owner_user_id", eu).eq("status", "no_show").gte("starts_at", de).lt("starts_at", ate)),
      contar(
        db
          .from("crm_proposals")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("sent_by_user_id", eu)
          .gte("sent_at", de)
          .lt("sent_at", ate),
      ),
      db
        .from("crm_leads")
        .select("value_cents")
        .eq("organization_id", orgId)
        .eq("owner_user_id", eu)
        .eq("status", "won")
        .gte("closed_at", de)
        .lt("closed_at", ate)
        .limit(5000),
      db
        .from("crm_leads")
        .select("lost_reason")
        .eq("organization_id", orgId)
        .eq("owner_user_id", eu)
        .eq("status", "lost")
        .gte("closed_at", de)
        .lt("closed_at", ate)
        .limit(5000),
    ]);
    if (ganhos.error) throw new Error(ganhos.error.message);
    if (perdidos.error) throw new Error(perdidos.error.message);
    const vendas = (ganhos.data ?? []) as Array<{ value_cents: number | null }>;
    // "Levado para outro funil" é passagem, não perda (ver `ehPerdaDeVerdade`).
    const perdas = ((perdidos.data ?? []) as Array<{ lost_reason: string | null }>).filter((p) => ehPerdaDeVerdade(p.lost_reason));
    const numeros: NumerosDoVendedor = {
      visao: "vendedor",
      carteira_aberta: carteira,
      agendamentos,
      compareceram: vieram,
      nao_vieram: faltaram,
      propostas_enviadas: propostas,
      vendas: vendas.length,
      valor_vendido_cents: vendas.reduce((s, v) => s + (v.value_cents ?? 0), 0),
      perdas: perdas.length,
      motivos_de_perda: topMotivos(perdas.map((p) => p.lost_reason)),
    };
    return ok({ periodo, de, ate, numeros }, { requestId });
  } catch (erro) {
    return fail("internal_error", erro instanceof Error ? erro.message : String(erro), 500, { requestId });
  }
}
