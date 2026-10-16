/**
 * Os fios da esteira (ia.vek D3): cada operação de `DepsDaEsteira` pelo MESMO
 * caminho que a tela usa — clone pela função da rota de clone, mover pelo
 * `moveLeadHandler`, tarefa pelo `criarTarefaInterna`, handoff pelo
 * `performHumanHandoff` da IA. O ator é de sistema (`webhook_source: esteira`):
 * quem agiu foi a regra, não uma pessoa.
 *
 * Service role: TODA consulta filtra `organization_id` (CLAUDE.md, multi-tenancy).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { performHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { clonarLeadParaFunil } from "@/lib/leads/clonar-lead-para-funil";
import { logger } from "@/lib/logger";
import { enviarPushAoUsuario } from "@/lib/notifications/web_push";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";

import { usuariosDoDestinatario, type Destinatario } from "./config";
import {
  PREFIXO_DE_LIGACAO,
  TITULO_DA_LIGACAO,
  sourceKindDaLigacao,
  type CodigoDeLigacao,
  type DepsDaEsteira,
  type LeadDaEsteira,
  type LigacaoPendente,
} from "./rodada";

export const ATOR_DA_ESTEIRA = { type: "webhook_source", id: "esteira" } as const;

type LinhaDeLead = {
  id: string;
  contact_id: string | null;
  stage_id: string;
  created_at: string;
  owner_user_id: string | null;
  source_metadata: Record<string, unknown> | null;
};

function paraLeadDaEsteira(r: LinhaDeLead): LeadDaEsteira {
  const inicio = r.source_metadata?.esteira_inicio;
  return {
    id: r.id,
    contact_id: r.contact_id,
    stage_id: r.stage_id,
    created_at: r.created_at,
    owner_user_id: r.owner_user_id,
    inicio: typeof inicio === "string" && !Number.isNaN(Date.parse(inicio)) ? inicio : r.created_at,
  };
}

const URGENTES: ReadonlySet<CodigoDeLigacao> = new Set(["L1", "quente"]);

export function depsReaisDaEsteira(admin: SupabaseClient, orgId: string, agora: () => Date): DepsDaEsteira {
  const ctx: HandlerCtx = {
    organization_id: orgId,
    actor: ATOR_DA_ESTEIRA,
    requestId: `esteira-${agora().toISOString()}`,
  };

  return {
    agora,

    async leadsAbertos(pipelineId) {
      const { data, error } = await admin
        .from("crm_leads")
        .select("id, contact_id, stage_id, created_at, owner_user_id, source_metadata")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipelineId)
        .eq("status", "open")
        .limit(2000);
      if (error) throw new Error(`esteira: leads do funil: ${error.message}`);
      return ((data ?? []) as LinhaDeLead[]).map(paraLeadDaEsteira);
    },

    async passarParaFollowup(lead, etapaId) {
      const { data: etapa } = await admin
        .from("crm_stages")
        .select("pipeline_id")
        .eq("organization_id", orgId)
        .eq("id", etapaId)
        .maybeSingle();
      if (!etapa) return { ok: false, erro: "etapa_do_followup_nao_existe" };
      const r = await clonarLeadParaFunil(admin, ctx, lead.id, {
        pipeline_id: (etapa as { pipeline_id: string }).pipeline_id,
        stage_id: etapaId,
      });
      if (!r.ok) {
        logger.warn("esteira_passagem_recusada", { organization_id: orgId, lead_id: lead.id, code: r.code });
        return { ok: false, erro: r.code };
      }
      const clone = r.clone as LinhaDeLead;
      const metadata = { ...(clone.source_metadata ?? {}), esteira_inicio: lead.inicio };
      await admin
        .from("crm_leads")
        .update({ source_metadata: metadata })
        .eq("organization_id", orgId)
        .eq("id", clone.id);

      // A conversa passa para a equipe (SDR): o MESMO handoff da IA — silencia,
      // cancela os follow-ups automáticos e abre o aviso crítico na Central.
      if (lead.contact_id) {
        try {
          const { data: conversa } = await admin
            .from("conversations")
            .select("id")
            .eq("organization_id", orgId)
            .eq("contact_id", lead.contact_id)
            .eq("is_group", false)
            .order("last_message_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          if (conversa) {
            await performHumanHandoff(
              getRequestPool(),
              { tenantId: orgId, leadId: lead.contact_id, conversationId: (conversa as { id: string }).id },
              {
                reason: "esteira_72h_sem_compromisso",
                conversationSummary:
                  "O cliente completou o período de atendimento da IA sem agendar visita nem vídeo. " +
                  "O negócio passou para o funil de follow-up; a equipe assume a conversa e a ligação (L3).",
                inboxTitle: "Esteira: fim das 72 h sem compromisso — a equipe assume",
                // Passagem PROGRAMADA: o cliente não está esperando resposta (não
                // escreveu e ficou no vácuo); quem fala com ele é a equipe, pela L3.
                avisoAoLead: {
                  avisado: false,
                  porque: "Passagem programada da esteira (72 h): o cliente não aguardava resposta; a equipe liga (L3).",
                },
                log: createLogger(),
              },
            );
          }
        } catch (err) {
          // O clone já existe: falhar aqui não desfaz a passagem; o aviso fica no log.
          logger.warn("esteira_handoff_falhou", {
            organization_id: orgId,
            lead_id: lead.id,
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
      return { ok: true, lead: paraLeadDaEsteira({ ...clone, source_metadata: metadata }) };
    },

    async mover(lead, etapaId) {
      try {
        await moveLeadHandler(admin, ctx, lead.id, {
          to_stage_id: etapaId,
          reason: "Esteira de vendas (automático)",
        });
        return true;
      } catch (err) {
        logger.warn("esteira_mover_falhou", {
          organization_id: orgId,
          lead_id: lead.id,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        return false;
      }
    },

    async comHandoff(leadIds) {
      if (leadIds.length === 0) return new Set();
      const { data } = await admin
        .from("crm_lead_activities")
        .select("lead_id")
        .eq("organization_id", orgId)
        .eq("type", "handoff_triggered")
        .in("lead_id", leadIds);
      return new Set(((data ?? []) as Array<{ lead_id: string }>).map((r) => r.lead_id));
    },

    async clienteFalouDesde(lead, desde) {
      if (!lead.contact_id) return false;
      const { rows } = await getRequestPool().query(
        `select 1 from messages m
           join conversations c on c.id = m.conversation_id and c.organization_id = m.organization_id
          where m.organization_id = $1 and c.contact_id = $2 and not c.is_group
            and m.direction = 'inbound' and m.created_at > $3
          limit 1`,
        [orgId, lead.contact_id, desde.toISOString()],
      );
      return rows.length > 0;
    },

    async ultimoReengajo(leadId) {
      const { data } = await admin
        .from("crm_lead_activities")
        .select("created_at")
        .eq("organization_id", orgId)
        .eq("lead_id", leadId)
        .eq("type", "esteira_reengajou")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? new Date((data as { created_at: string }).created_at) : null;
    },

    async marcarReengajou(lead) {
      await emitLeadActivity(admin, {
        organizationId: orgId,
        leadId: lead.id,
        contactId: lead.contact_id,
        type: "esteira_reengajou",
        sourceModule: "esteira",
        actor: ATOR_DA_ESTEIRA,
        reason: "O cliente voltou a falar durante o follow-up",
      });
    },

    async ligacoesJaCriadas(leadIds) {
      const mapa = new Map<string, Set<string>>();
      if (leadIds.length === 0) return mapa;
      const { data } = await admin
        .from("crm_tasks")
        .select("lead_id, source_kind")
        .eq("organization_id", orgId)
        .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
        .in("lead_id", leadIds);
      for (const r of (data ?? []) as Array<{ lead_id: string; source_kind: string }>) {
        if (!mapa.has(r.lead_id)) mapa.set(r.lead_id, new Set());
        mapa.get(r.lead_id)!.add(r.source_kind);
      }
      return mapa;
    },

    async criarLigacao(lead, codigo, venceEm) {
      const r = await criarTarefaInterna(admin, {
        organizationId: orgId,
        leadId: lead.id,
        contactId: lead.contact_id,
        titulo: `${TITULO_DA_LIGACAO[codigo]} — {{contact.name}}`,
        descricao:
          "Registre a ligação pelos 3 campos (atendeu?, resumo de 1 frase, próximo passo) ao concluir a tarefa.",
        venceEmDias: 0,
        venceEm,
        atribuirA: "dono_do_lead",
        prioridade: URGENTES.has(codigo) ? "urgent" : "high",
        origem: "esteira",
        sourceKind: sourceKindDaLigacao(codigo),
        aceitaSemResponsavel: true,
        agora: agora(),
      });
      if (!r.ok) {
        logger.warn("esteira_ligacao_nao_criada", { organization_id: orgId, lead_id: lead.id, codigo: r.codigo });
      }
      return r.ok;
    },

    async ligacoesVencidas(antesDe) {
      const { data } = await admin
        .from("crm_tasks")
        .select("id, lead_id, contact_id, title, due_date, assigned_to")
        .eq("organization_id", orgId)
        .in("status", ["pending", "in_progress"])
        .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
        .not("lead_id", "is", null)
        .lt("due_date", antesDe.toISOString())
        .limit(500);
      return (data ?? []) as LigacaoPendente[];
    },

    async cobrancasFeitas(tarefaIds) {
      const mapa = new Map<string, Set<number>>();
      if (tarefaIds.length === 0) return mapa;
      const { data } = await admin
        .from("crm_lead_activities")
        .select("payload")
        .eq("organization_id", orgId)
        .eq("type", "esteira_ligacao_cobrada")
        .in("source_id", tarefaIds);
      for (const r of (data ?? []) as Array<{ payload: { task_id?: string; nivel?: number } | null }>) {
        const id = r.payload?.task_id;
        if (!id || typeof r.payload?.nivel !== "number") continue;
        if (!mapa.has(id)) mapa.set(id, new Set());
        mapa.get(id)!.add(r.payload.nivel);
      }
      return mapa;
    },

    async cobrar(tarefa, nivel, destinatario) {
      await cobrarLigacao(admin, orgId, tarefa, nivel, destinatario);
    },
  };
}

/** A cobrança: marca (atividade), aviso na Central e push para quem o destinatário alcança. */
async function cobrarLigacao(
  admin: SupabaseClient,
  orgId: string,
  tarefa: LigacaoPendente,
  nivel: 1 | 2,
  destinatario: Destinatario,
): Promise<void> {
  // A marca primeiro: é ela que impede cobrar duas vezes, e falhar depois dela
  // perde um aviso (recuperável na lista de tarefas), nunca duplica.
  await emitLeadActivity(admin, {
    organizationId: orgId,
    leadId: tarefa.lead_id,
    contactId: tarefa.contact_id,
    type: "esteira_ligacao_cobrada",
    sourceModule: "esteira",
    sourceId: tarefa.id,
    actor: ATOR_DA_ESTEIRA,
    reason: nivel === 1 ? "Ligação atrasada: cobrança enviada" : "Ligação atrasada há 1 dia útil: segundo nível avisado",
    payload: { task_id: tarefa.id, nivel },
  });
  const titulo = `🚨 Ligação atrasada${nivel === 2 ? " (1 dia útil)" : ""}: ${tarefa.title}`;
  await admin.from("agent_inbox_items").insert({
    organization_id: orgId,
    kind: "other",
    severity: nivel === 2 ? "critical" : "warn",
    title: titulo.slice(0, 200),
    body: "A ligação passou do prazo sem registro. Abra a tarefa, ligue e registre os 3 campos.",
    ref_kind: "crm_lead",
    ref_id: tarefa.lead_id,
  });
  const usuarios = new Set(await usuariosDoDestinatario(admin, orgId, destinatario));
  if (nivel === 1 && tarefa.assigned_to) usuarios.add(tarefa.assigned_to);
  for (const u of usuarios) {
    try {
      await enviarPushAoUsuario(orgId, u, {
        title: nivel === 2 ? "Ligação atrasada há 1 dia útil" : "Ligação atrasada",
        body: tarefa.title.slice(0, 120),
        tag: `ligacao:${tarefa.id}:${nivel}`,
        href: "/app/tasks",
      });
    } catch (err) {
      logger.warn("esteira_push_falhou", { organization_id: orgId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
