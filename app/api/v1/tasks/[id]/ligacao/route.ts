/**
 * POST /api/v1/tasks/[id]/ligacao — registra a LIGAÇÃO de uma tarefa da esteira
 * (ia.vek D3) pelos 3 campos e aplica os efeitos (`lib/esteira/registro-de-ligacao.ts`).
 *
 * Só para tarefa de ligação (`source_kind` `ligacao:*`) ainda aberta. A tarefa
 * fecha, a linha "Ligação registrada" entra na timeline com os 3 campos, e o
 * próximo passo mexe no negócio pelos MESMOS caminhos da tela (mover, perder,
 * criar tarefa). Agente ou acima, como concluir tarefa.
 */
import { requireSupportWrite } from "@/lib/impersonate/support";
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { configDaEsteira } from "@/lib/esteira/config";
import { efeitosDoRegistro, registroDeLigacaoSchema } from "@/lib/esteira/registro-de-ligacao";
import { PREFIXO_DE_LIGACAO, ehLigacao } from "@/lib/esteira/rodada";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { createClient } from "@/lib/supabase/server";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";
import type { Tarefa } from "@/lib/tarefas/tipos";

export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const parsed = registroDeLigacaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", parsed.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      requestId,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const registro = parsed.data;
  const supabase = await createClient();

  const { data: tarefaLida } = await supabase
    .from("crm_tasks")
    .select("id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_by, created_at, updated_at, source_kind")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const tarefa = tarefaLida as (Tarefa & { source_kind: string | null }) | null;
  if (!tarefa) return fail("not_found", "Tarefa não encontrada.", 404, { requestId });
  if (!ehLigacao(tarefa.source_kind)) {
    return fail("validation_failed", "Esta tarefa não é uma ligação da esteira.", 422, { requestId });
  }
  if (tarefa.status === "done" || tarefa.status === "cancelled") {
    return fail("conflict", "Esta ligação já foi registrada.", 409, { requestId });
  }

  const { data: negocioLido } = tarefa.lead_id
    ? await supabase
        .from("crm_leads")
        .select("id, pipeline_id, status, contact_id")
        .eq("id", tarefa.lead_id)
        .eq("organization_id", orgId)
        .maybeSingle()
    : { data: null };
  const negocio = negocioLido as { id: string; pipeline_id: string; status: string; contact_id: string | null } | null;
  const { data: orgRow } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const cfg = configDaEsteira((orgRow as { settings?: unknown } | null)?.settings);
  const agora = new Date();
  const efeitos = efeitosDoRegistro(
    registro,
    { source_kind: tarefa.source_kind! },
    negocio ? { pipelineId: negocio.pipeline_id, status: negocio.status } : null,
    cfg,
    agora,
  );

  // 1. A tarefa fecha. Condicional ao status de antes: dois cliques não registram duas vezes.
  const { data: fechada, error: errFechar } = await supabase
    .from("crm_tasks")
    .update({ status: "done" })
    .eq("id", id)
    .eq("organization_id", orgId)
    .in("status", ["pending", "in_progress"])
    .select("id");
  if (errFechar) return fail("internal_error", "Não deu para fechar a tarefa.", 500, { requestId });
  if (!fechada || fechada.length === 0) {
    return fail("conflict", "Esta ligação já foi registrada.", 409, { requestId });
  }

  const actor = { type: "user", id: authz.user.id } as const;
  await registraAtividadeDaTarefa(supabase, { organizationId: orgId, tarefa, tipo: "task_completed", actor });
  if (negocio) {
    await emitLeadActivity(supabase, {
      organizationId: orgId,
      leadId: negocio.id,
      contactId: negocio.contact_id,
      type: "call_logged",
      sourceModule: "esteira",
      sourceId: tarefa.id,
      actor,
      reason: `${registro.atendeu ? "Atendeu" : "Não atendeu"}: ${registro.resumo}`,
      payload: {
        task_id: tarefa.id,
        codigo: tarefa.source_kind!.slice(PREFIXO_DE_LIGACAO.length),
        atendeu: registro.atendeu,
        resumo: registro.resumo,
        proximo: registro.proximo ?? null,
      },
    });
  }

  // 2. Os efeitos do próximo passo.
  const handlerCtx: HandlerCtx = { organization_id: orgId, actor, requestId, idioma: authz.user.idioma };
  const aplicados: string[] = [];
  try {
    for (const e of efeitos) {
      if (e.tipo === "nova_ligacao" && negocio) {
        const r = await criarTarefaInterna(supabase, {
          organizationId: orgId,
          leadId: negocio.id,
          contactId: negocio.contact_id,
          titulo: e.titulo,
          descricao: "Registre a ligação pelos 3 campos ao concluir.",
          venceEmDias: 0,
          venceEm: e.venceEm,
          atribuirA: tarefa.assigned_to ? { usuario_id: tarefa.assigned_to } : "dono_do_lead",
          prioridade: "high",
          origem: "esteira",
          sourceKind: e.sourceKind,
          aceitaSemResponsavel: true,
          agora,
          requestId,
        });
        if (r.ok) aplicados.push(e.sourceKind);
      } else if (e.tipo === "mover" && negocio) {
        await moveLeadHandler(supabase, handlerCtx, negocio.id, {
          to_stage_id: e.etapaId,
          reason: `Ligação: ${registro.resumo}`,
        });
        aplicados.push("mover");
      } else if (e.tipo === "cancelar_ligacoes_pendentes" && negocio) {
        await supabase
          .from("crm_tasks")
          .update({ status: "cancelled" })
          .eq("organization_id", orgId)
          .eq("lead_id", negocio.id)
          .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
          .in("status", ["pending", "in_progress"]);
        aplicados.push("cancelar_pendentes");
      } else if (e.tipo === "perder" && negocio) {
        await encerraDemanda(supabase, handlerCtx, {
          leadId: negocio.id,
          desfecho: "lost",
          motivo: e.motivo,
          razaoNaTimeline: e.detalhe ? `Ligação: ${e.detalhe}` : `Ligação: ${registro.resumo}`,
        });
        aplicados.push("perder");
      }
    }
  } catch (err) {
    // A ligação já está registrada; o efeito que falhou volta como recusa legível.
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, { requestId, details: { registrada: true, aplicados } });
    }
    throw err;
  }

  void audit({
    action: "esteira.ligacao_registrada",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "crm_tasks",
    resourceId: tarefa.id,
    requestId,
    metadata: { atendeu: registro.atendeu, proximo: registro.proximo?.tipo ?? null, aplicados },
  });
  return ok({ registrada: true, aplicados }, { requestId, status: 201 });
}
