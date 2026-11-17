/**
 * O REGISTRO DA LIGAÇÃO, compartilhado pelas duas portas (ia.vek D3 + CRM-532):
 *   - POST /api/v1/tasks/[id]/ligacao     — a tarefa de ligação da esteira (a tela de Tarefas);
 *   - POST /api/v1/contacts/[id]/ligacao  — o "Como foi a ligação?" depois do botão "Ligar".
 *
 * Com TAREFA: fecha a tarefa (condicional ao status de antes: dois cliques não registram duas vezes), grava
 * "Ligação registrada" (call_logged) no negócio e aplica o próximo passo — exatamente o que a rota da tarefa fazia
 * antes do CRM-532 (o corpo saiu dela para cá, sem mudar nada).
 *
 * SEM tarefa (CRM-532, `LIGACAO_SEM_TAREFA_REGISTRA` em lib/ligar/regras.ts): não há o que fechar; grava o call_logged no
 * negócio e aplica o MESMO próximo passo, como se fosse uma ligação avulsa (`ligacao:avulsa`): não atendeu cria a
 * retentativa do dia; agendou move para o compromisso; retornar cria a ligação de retorno; sem interesse perde.
 *
 * (Lupa 200426) "registrei" sem registro é o pior caso para quem liga. Por isso:
 *   - quem chama JÁ leu a tarefa pelo cliente da sessão: não aparece = 404; aparece fechada = 409 "já registrada";
 *   - aqui, a tarefa ABERTA cujo fechamento volta com 0 linhas é a RLS barrando: 403, e NADA mais é gravado;
 *   - a linha do tempo (call_logged) que falha DESFAZ o fechamento da tarefa (volta ao status de antes), vai ao log e
 *     responde erro: nunca sucesso sem o registro.
 */
import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { configDaEsteira } from "@/lib/esteira/config";
import { efeitosDoRegistro, type RegistroDeLigacao } from "@/lib/esteira/registro-de-ligacao";
import { PREFIXO_DE_LIGACAO } from "@/lib/esteira/rodada";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { encerraDemanda } from "@/lib/leads/encerramento";
import { logger } from "@/lib/logger";
import type { createClient } from "@/lib/supabase/server";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";
import type { Tarefa } from "@/lib/tarefas/tipos";

/** O `source_kind` de uma ligação SEM tarefa (só para decidir os efeitos; nunca gravado numa tarefa). */
export const SOURCE_KIND_AVULSA = `${PREFIXO_DE_LIGACAO}avulsa`;

/** O `cancelada_motivo` das ligações que o registro fecha (agendou / sem interesse), no molde da 0639/0640. */
export const MOTIVO_LIGACAO_REGISTRADA = "ligacao_registrada";

export interface NegocioDaLigacao {
  id: string;
  pipeline_id: string;
  status: string;
  contact_id: string | null;
}

export async function registrarLigacao(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  orgId: string;
  user: { id: string; idioma: HandlerCtx["idioma"] };
  requestId: string;
  registro: RegistroDeLigacao;
  /** A tarefa de ligação aberta, ou null (a ligação avulsa do botão "Ligar"). */
  tarefa: (Tarefa & { source_kind: string | null }) | null;
  negocio: NegocioDaLigacao | null;
  /** De onde veio, para a timeline e o audit. */
  origem: "esteira" | "ligar";
}): Promise<Response> {
  const { supabase, orgId, user, requestId, registro, tarefa, negocio, origem } = args;
  const sourceKind = tarefa?.source_kind ?? SOURCE_KIND_AVULSA;

  const { data: orgRow } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const cfg = configDaEsteira((orgRow as { settings?: unknown } | null)?.settings);
  const agora = new Date();
  const efeitos = efeitosDoRegistro(
    registro,
    { source_kind: sourceKind },
    negocio ? { pipelineId: negocio.pipeline_id, status: negocio.status } : null,
    cfg,
    agora,
  );

  const actor = { type: "user", id: user.id } as const;

  // 1. A tarefa fecha (se houver). Condicional ao status de antes: dois cliques não registram duas vezes.
  if (tarefa) {
    const { data: fechada, error: errFechar } = await supabase
      .from("crm_tasks")
      .update({ status: "done" })
      .eq("id", tarefa.id)
      .eq("organization_id", orgId)
      .in("status", ["pending", "in_progress"])
      .select("id");
    if (errFechar) return fail("internal_error", "Não deu para fechar a tarefa.", 500, { requestId });
    if (!fechada || fechada.length === 0) {
      // quem chamou já viu a tarefa ABERTA pela sessão: 0 linhas aqui é a RLS barrando o fechamento (não "já registrada")
      return fail("forbidden", "Você não pode fechar esta tarefa de ligação.", 403, { requestId });
    }
  }

  if (negocio) {
    const linha = await emitLeadActivity(supabase, {
      organizationId: orgId,
      leadId: negocio.id,
      contactId: negocio.contact_id,
      type: "call_logged",
      sourceModule: origem,
      sourceId: tarefa?.id ?? negocio.id,
      actor,
      reason: `${registro.atendeu ? "Atendeu" : "Não atendeu"}: ${registro.resumo}`,
      payload: {
        task_id: tarefa?.id ?? null,
        codigo: sourceKind.slice(PREFIXO_DE_LIGACAO.length),
        atendeu: registro.atendeu,
        resumo: registro.resumo,
        proximo: registro.proximo ?? null,
      },
    });
    if (!linha.ok) {
      // a ligação NÃO ficou registrada: desfaz o fechamento da tarefa e responde erro (nunca sucesso sem registro)
      if (tarefa) {
        const { data: desfeita, error: errDesfazer } = await supabase
          .from("crm_tasks")
          .update({ status: tarefa.status })
          .eq("id", tarefa.id)
          .eq("organization_id", orgId)
          .eq("status", "done")
          .select("id");
        if (errDesfazer || !desfeita || desfeita.length !== 1) {
          // (Lupa 200617) a tarefa ficou 'done' SEM o call_logged: outro nome no log, para alguém achar e corrigir
          logger.error("[ligacao] desfazer falhou", {
            request_id: requestId,
            org_id: orgId,
            task_id: tarefa.id,
            status_de_antes: tarefa.status,
            erro: (errDesfazer?.message ?? `linhas desfeitas: ${desfeita?.length ?? 0}`).slice(0, 200),
          });
        }
      }
      logger.error("[ligacao] call_logged não gravou; tarefa desfeita", {
        request_id: requestId,
        org_id: orgId,
        lead_id: negocio.id,
        task_id: tarefa?.id ?? null,
        erro: (linha.error ?? "").slice(0, 200),
      });
      return fail("internal_error", "Não consegui registrar a ligação. Nada foi salvo; tente de novo.", 500, { requestId });
    }
  }
  if (tarefa) {
    await registraAtividadeDaTarefa(supabase, { organizationId: orgId, tarefa, tipo: "task_completed", actor });
  }

  // 2. Os efeitos do próximo passo.
  const handlerCtx: HandlerCtx = { organization_id: orgId, actor, requestId, idioma: user.idioma };
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
          // sem tarefa, quem ligou é quem fica com a próxima (ele é quem combinou com o cliente)
          atribuirA: tarefa
            ? tarefa.assigned_to
              ? { usuario_id: tarefa.assigned_to }
              : "dono_do_lead"
            : { usuario_id: user.id },
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
        // (Lupa 205419) como a 0639/0640: o MOTIVO na tarefa e 1 linha task_cancelled por tarefa na linha do tempo
        const { data: canceladas } = await supabase
          .from("crm_tasks")
          .update({ status: "cancelled", cancelada_motivo: MOTIVO_LIGACAO_REGISTRADA })
          .eq("organization_id", orgId)
          .eq("lead_id", negocio.id)
          .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
          .in("status", ["pending", "in_progress"])
          .select("id, contact_id, title, source_kind");
        for (const c of (canceladas ?? []) as { id: string; contact_id: string | null; title: string; source_kind: string | null }[]) {
          await emitLeadActivity(supabase, {
            organizationId: orgId,
            leadId: negocio.id,
            contactId: c.contact_id ?? negocio.contact_id,
            type: "task_cancelled",
            sourceModule: "tarefas",
            sourceId: c.id,
            actor,
            reason: `Ligação fechada: ${MOTIVO_LIGACAO_REGISTRADA}`,
            payload: { motivo: MOTIVO_LIGACAO_REGISTRADA, ligacao: c.source_kind, titulo: (c.title ?? "").slice(0, 200), origem: "ligacao" },
          });
        }
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
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: tarefa ? "crm_tasks" : "crm_leads",
    resourceId: tarefa?.id ?? negocio?.id ?? null,
    requestId,
    metadata: { atendeu: registro.atendeu, proximo: registro.proximo?.tipo ?? null, aplicados, origem },
  });
  return ok({ registrada: true, aplicados }, { requestId, status: 201 });
}
