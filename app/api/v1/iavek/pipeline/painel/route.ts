/**
 * GET /api/v1/iavek/pipeline/painel — ia.vek v1.9.8 (CRM-218).
 *
 * Os contadores fixos no topo do Pipeline e os leads que têm tarefa aberta
 * (para o aviso "sem tarefa" no cartão). O recorte é o MESMO do quadro:
 *  - guardião e Suporte IA: os leads de que é dono OU guardião, nas etapas do
 *    lado dele no funil de entrada e em todo o funil de follow-up;
 *  - vendedor: os leads de que é dono, nas etapas do lado dele;
 *  - gerente, apoio e quem não tem função (o admin): a loja inteira.
 * Os dois funis (entrada e follow-up) entram sempre: os contadores são fixos e
 * não mudam com o botão Novos / Follow-up / Todos.
 *
 * Lê pela SESSÃO: a RLS decide o que cada um enxerga; a rota só recorta.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { limitesDoDia } from "@/lib/iavek/meu-dia";
import { etapaDoLado, lerLados } from "@/lib/iavek/lados-do-funil";
import {
  TAREFA_ABERTA,
  contarSemTarefa,
  contarTarefas,
  funisDaLoja,
  recorteDaFuncao,
  type ContadoresDoPipeline,
} from "@/lib/iavek/painel-do-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Teto de segurança das leituras: a loja maior hoje tem ~600 leads abertos. */
const TETO = 5_000;

interface LinhaDoLead {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const eu = authz.user.id;
  const fuso = authz.org.timezone || "America/Sao_Paulo";
  const agora = new Date();
  const hoje = limitesDoDia(agora, fuso);
  const recorte = recorteDaFuncao(authz.org.interface_settings?.funcao);

  const { data: org, error: erroOrg } = await createAdminClient()
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (erroOrg) return fail("internal_error", erroOrg.message, 500, { requestId });

  const supabase = await createClient();
  const { data: padrao } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  const funis = funisDaLoja(org?.settings, (padrao as { id: string } | null)?.id ?? null);
  const vazio: ContadoresDoPipeline = { tarefas_hoje: 0, atrasadas: 0, sem_tarefa: 0, visitas_hoje: 0 };
  if (!funis) return ok({ contadores: vazio, com_tarefa: [] }, { requestId });
  const idsDosFunis = [funis.entrada, ...(funis.followup ? [funis.followup] : [])];

  let consulta = supabase
    .from("crm_leads")
    .select("id, pipeline_id, stage_id, contact_id")
    .eq("organization_id", orgId)
    .eq("status", "open")
    .in("pipeline_id", idsDosFunis)
    .limit(TETO);
  if (recorte.tipo === "carteira") {
    consulta =
      recorte.lado === "sdr"
        ? consulta.or(`owner_user_id.eq.${eu},sdr_user_id.eq.${eu}`)
        : consulta.eq("owner_user_id", eu);
  }
  const [{ data: linhas, error: erroLeads }, { data: funilDeEntrada }] = await Promise.all([
    consulta,
    supabase.from("crm_pipelines").select("settings").eq("id", funis.entrada).maybeSingle(),
  ]);
  if (erroLeads) return fail("internal_error", erroLeads.message, 500, { requestId });

  // O lado recorta as etapas SÓ no funil de entrada (o de follow-up não tem lados).
  const lados = lerLados((funilDeEntrada as { settings?: unknown } | null)?.settings);
  const lado = recorte.tipo === "carteira" ? recorte.lado : null;
  const leads = ((linhas ?? []) as LinhaDoLead[]).filter(
    (l) => l.pipeline_id !== funis.entrada || etapaDoLado(lados, l.stage_id, lado),
  );
  const idsDosLeads = leads.map((l) => l.id);
  const contatos = [...new Set(leads.map((l) => l.contact_id).filter((c): c is string => !!c))];

  // Tarefas abertas: as dos meus leads (para o "sem tarefa") e, para os
  // números de hoje e atrasadas, também as atribuídas a mim sem lead da carteira.
  const [tarefasDosLeads, tarefasMinhas, visitas] = await Promise.all([
    buscaEmLotes(idsDosLeads, (lote) =>
      supabase
        .from("crm_tasks")
        .select("id, lead_id, due_date")
        .eq("organization_id", orgId)
        .in("status", [...TAREFA_ABERTA])
        .in("lead_id", lote),
    ),
    recorte.tipo === "carteira"
      ? supabase
          .from("crm_tasks")
          .select("id, lead_id, due_date")
          .eq("organization_id", orgId)
          .in("status", [...TAREFA_ABERTA])
          .eq("assigned_to", eu)
          .limit(TETO)
      : supabase
          .from("crm_tasks")
          .select("id, lead_id, due_date")
          .eq("organization_id", orgId)
          .in("status", [...TAREFA_ABERTA])
          .limit(TETO),
    visitasDeHoje(supabase, orgId, hoje, recorte.tipo === "carteira" ? { eu, contatos } : null),
  ]);
  if (tarefasDosLeads.error) return fail("internal_error", tarefasDosLeads.error.message, 500, { requestId });
  if (tarefasMinhas.error) return fail("internal_error", tarefasMinhas.error.message, 500, { requestId });
  if (visitas.error) return fail("internal_error", visitas.error, 500, { requestId });

  type Tarefa = { id: string; lead_id: string | null; due_date: string | null };
  const porId = new Map<string, Tarefa>();
  for (const t of [...tarefasDosLeads.data, ...((tarefasMinhas.data ?? []) as Tarefa[])]) porId.set(t.id, t as Tarefa);
  const doLeadVisivel = new Set(idsDosLeads);
  const comTarefa = new Set(
    [...porId.values()].map((t) => t.lead_id).filter((id): id is string => !!id && doLeadVisivel.has(id)),
  );

  const contadores: ContadoresDoPipeline = {
    ...contarTarefas([...porId.values()], agora, hoje),
    sem_tarefa: contarSemTarefa(idsDosLeads, comTarefa),
    visitas_hoje: visitas.total,
  };
  return ok({ contadores, com_tarefa: [...comTarefa] }, { requestId });
}

/**
 * As visitas (compromissos da agenda, não cancelados) de HOJE no fuso da loja.
 * Na carteira: as que a pessoa atende e as dos clientes dela (o guardião marca
 * a visita no nome do vendedor, e ela continua sendo do lead dele).
 */
async function visitasDeHoje(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  hoje: { inicio: Date; fim: Date },
  carteira: { eu: string; contatos: string[] } | null,
): Promise<{ total: number; error: string | null }> {
  const base = () =>
    supabase
      .from("calendar_appointments")
      .select("id")
      .eq("organization_id", orgId)
      .neq("status", "cancelled")
      .gte("starts_at", hoje.inicio.toISOString())
      .lt("starts_at", hoje.fim.toISOString());
  if (!carteira) {
    const { data, error } = await base().limit(TETO);
    return { total: (data ?? []).length, error: error?.message ?? null };
  }
  const [minhas, dosClientes] = await Promise.all([
    base().eq("owner_user_id", carteira.eu).limit(TETO),
    buscaEmLotes(carteira.contatos, (lote) => base().in("contact_id", lote)),
  ]);
  if (minhas.error) return { total: 0, error: minhas.error.message };
  if (dosClientes.error) return { total: 0, error: dosClientes.error.message };
  const ids = new Set([...(minhas.data ?? []), ...dosClientes.data].map((v) => (v as { id: string }).id));
  return { total: ids.size, error: null };
}
