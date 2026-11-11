/**
 * ia.vek v1.9.45 (CRM-294): a ligação dos 7 dias antes da Compra futura.
 *
 * Regra aprovada pelo Rodrigo (11/11): 7 dias antes do mês previsto, nasce uma TAREFA DE LIGAÇÃO para o
 * MESMO vendedor que atendia quando o lead foi para Compra futura. Se ele saiu da loja (não é mais membro
 * ativo), vai para o GUARDIÃO do lead (crm_leads.sdr_user_id). Sem nenhum dos dois, nasce sem dono (como a
 * ligação da esteira), e aparece para quem distribui.
 *
 * Roda DENTRO da rodada da esteira (a mesma trava por organização: duas rodadas nunca dobram). A marca
 * `compra_futura_tarefa_em` é gravada ANTES da tarefa, numa escrita CONDICIONAL (só se ainda estava nula):
 * se duas cópias chegarem juntas, só uma cria. Se a tarefa falhar, a marca é desfeita e a próxima rodada tenta.
 * O lead NÃO muda de status: segue em Compra futura até o vendedor o reabrir (condição 2 do Maestro).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";

export const DIAS_ANTES_DA_COMPRA_FUTURA = 7;

/** Hoje no fuso de São Paulo, "AAAA-MM-DD". */
export function hojeEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

/** O último mês cuja ligação já vence: o mês previsto ≤ hoje + 7 dias. */
export function limiteDoMes(agora: Date): string {
  const d = new Date(`${hojeEmSaoPaulo(agora)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + DIAS_ANTES_DA_COMPRA_FUTURA);
  return d.toISOString().slice(0, 10);
}

interface LeadFuturo {
  id: string;
  title: string;
  compra_futura_mes: string;
  compra_futura_vendedor_id: string | null;
  sdr_user_id: string | null;
}

export interface ResumoDaCompraFutura {
  tarefas: number;
  paraOVendedor: number;
  paraOGuardiao: number;
  semDono: number;
  falhas: number;
}

export async function rodarCompraFutura(
  admin: SupabaseClient,
  orgId: string,
  agora: Date = new Date(),
): Promise<ResumoDaCompraFutura> {
  const r: ResumoDaCompraFutura = { tarefas: 0, paraOVendedor: 0, paraOGuardiao: 0, semDono: 0, falhas: 0 };
  const { data: leads, error } = await admin
    .from("crm_leads")
    .select("id, title, compra_futura_mes, compra_futura_vendedor_id, sdr_user_id")
    .eq("organization_id", orgId)
    .eq("status", "future")
    .is("compra_futura_tarefa_em", null)
    .lte("compra_futura_mes", limiteDoMes(agora))
    .order("compra_futura_mes", { ascending: true })
    .limit(200);
  if (error) throw new Error(`compra_futura_leitura: ${error.message}`);
  if (!leads?.length) return r;

  const { data: membros } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .is("revoked_at", null);
  const ativos = new Set(((membros ?? []) as Array<{ user_id: string }>).map((m) => m.user_id));

  for (const l of leads as LeadFuturo[]) {
    // a marca primeiro, condicional: só uma cópia passa
    const { data: marcado } = await admin
      .from("crm_leads")
      .update({ compra_futura_tarefa_em: agora.toISOString() })
      .eq("organization_id", orgId)
      .eq("id", l.id)
      .eq("status", "future")
      .is("compra_futura_tarefa_em", null)
      .select("id")
      .maybeSingle();
    if (!marcado) continue;

    const vendedor = l.compra_futura_vendedor_id && ativos.has(l.compra_futura_vendedor_id) ? l.compra_futura_vendedor_id : null;
    const guardiao = !vendedor && l.sdr_user_id && ativos.has(l.sdr_user_id) ? l.sdr_user_id : null;
    const quem = vendedor ?? guardiao;
    const mes = new Date(`${l.compra_futura_mes}T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    const tarefa = await criarTarefaInterna(admin, {
      organizationId: orgId,
      titulo: `📅 Compra futura (${mes}): ligar para {{contact.name}}`,
      descricao: `O cliente disse que compraria em ${mes}. Ligue, veja se o momento chegou e, se sim, traga o lead de volta para uma etapa aberta.`,
      venceEmDias: 0,
      // sem vendedor nem guardião ativos: SEM dono (nunca cair no dono antigo, que pode ter saído)
      atribuirA: quem ? { usuario_id: quem } : "ninguem",
      prioridade: "high",
      leadId: l.id,
      origem: "iavek:compra_futura",
      sourceKind: "ligacao",
      aceitaSemResponsavel: true,
      agora,
    }).catch((e: unknown) => ({ ok: false as const, codigo: "falha" as const, erro: String(e) }));

    if (!tarefa.ok) {
      r.falhas++;
      logger.warn("compra_futura_tarefa_falhou", { organization_id: orgId, lead_id: l.id, codigo: tarefa.codigo });
      // desfaz a marca: a próxima rodada tenta de novo
      await admin.from("crm_leads").update({ compra_futura_tarefa_em: null }).eq("organization_id", orgId).eq("id", l.id);
      continue;
    }
    r.tarefas++;
    if (vendedor) r.paraOVendedor++;
    else if (guardiao) r.paraOGuardiao++;
    else r.semDono++;
  }
  return r;
}
