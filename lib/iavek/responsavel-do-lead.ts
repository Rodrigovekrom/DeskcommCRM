import type { SupabaseClient } from "@supabase/supabase-js";

import { ROTULO_DA_FUNCAO, funcaoDaTela } from "@/lib/iavek/funcoes";
import { nomesDosAtendentes } from "@/lib/users/nome-do-atendente";

/**
 * ia.vek v1.9.5 — RESPONSÁVEL FÁCIL DE VER (CRM-196, feedback do Lucas): no
 * lead e no cartão do Pipeline, quem é o responsável (nome e FUNÇÃO na loja),
 * o guardião, e qual é o OBJETIVO ATUAL do lead — o próximo passo combinado
 * (a tarefa em aberto que vence primeiro: próximo passo, ligação, tarefa).
 * Service role, sempre filtrando a organização; quem chama já recortou os
 * leads pela sessão (RLS).
 */
export interface PessoaDoLead {
  nome: string | null;
  funcao: string | null;
}
export interface ObjetivoDoLead {
  titulo: string;
  vence_em: string | null;
}

/** Nome e rótulo da função na loja de cada pessoa (sem função: só o nome). */
export async function pessoasDosLeads(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<Record<string, PessoaDoLead>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (unicos.length === 0) return {};
  const [nomes, { data: vinculos }] = await Promise.all([
    nomesDosAtendentes(unicos),
    admin
      .from("user_organizations")
      .select("user_id, interface_settings")
      .eq("organization_id", orgId)
      .in("user_id", unicos),
  ]);
  const funcoes = new Map(
    (vinculos ?? []).map((v) => [
      v.user_id as string,
      funcaoDaTela((v.interface_settings as { funcao?: unknown } | null)?.funcao),
    ]),
  );
  return Object.fromEntries(
    unicos.map((id) => {
      const f = funcoes.get(id) ?? null;
      return [id, { nome: nomes.get(id) ?? null, funcao: f ? ROTULO_DA_FUNCAO[f] : null }];
    }),
  );
}

/** O objetivo atual de cada lead: a tarefa em aberto que vence primeiro. */
export async function objetivosDosLeads(
  admin: SupabaseClient,
  orgId: string,
  leadIds: string[],
): Promise<Record<string, ObjetivoDoLead>> {
  if (leadIds.length === 0) return {};
  const { data } = await admin
    .from("crm_tasks")
    .select("lead_id, title, due_date")
    .eq("organization_id", orgId)
    .in("lead_id", leadIds.slice(0, 1000))
    .in("status", ["pending", "in_progress"])
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(5000);
  const objetivos: Record<string, ObjetivoDoLead> = {};
  for (const t of (data ?? []) as Array<{ lead_id: string | null; title: string; due_date: string | null }>) {
    if (t.lead_id && !objetivos[t.lead_id]) objetivos[t.lead_id] = { titulo: t.title, vence_em: t.due_date };
  }
  return objetivos;
}
