/**
 * Os fios da esteira (ia.vek D3): cada operação de `DepsDaEsteira` pelo MESMO
 * caminho que a tela usa — clone pela função da rota de clone, mover pelo
 * `moveLeadHandler`, tarefa pelo `criarTarefaInterna`, handoff pelo
 * `performHumanHandoff` da IA. O ator é de sistema (`webhook_source: esteira`):
 * quem agiu foi a regra, não uma pessoa.
 *
 * Service role: TODA consulta filtra `organization_id` (CLAUDE.md, multi-tenancy).
 */
import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { passarAConversa } from "@/lib/iavek/passar-a-conversa";
import { conversaSegueODono } from "@/lib/iavek/conversa-segue-o-dono";
import type { SupabaseClient } from "@supabase/supabase-js";

import { moveLeadHandler } from "@/app/api/v1/leads/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import { performHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { clonarLeadParaFunil } from "@/lib/leads/clonar-lead-para-funil";
import { logger } from "@/lib/logger";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { lerTudo, todasAsPaginas } from "@/lib/supabase/paginas";
import { manterAteDoLead, nascimentoDoLead } from "@/lib/iavek/cronometro-72h";
import { enviarPushAoUsuario } from "@/lib/notifications/web_push";
import { criarTarefaInterna } from "@/lib/tarefas/criar-tarefa";
import { lerLeadDaPassagem, reativarLead } from "@/lib/iavek/passagem-servidor";
import { gravarCarroDoAnuncio, registrarDesfechoDoCarro } from "@/lib/iavek/carro-do-anuncio-servidor";

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
  return {
    id: r.id,
    contact_id: r.contact_id,
    stage_id: r.stage_id,
    created_at: r.created_at,
    owner_user_id: r.owner_user_id,
    // D6: o mesmo relógio do cronômetro, da passagem e do Space.
    inicio: nascimentoDoLead(r),
    manter_ate: manterAteDoLead(r),
    lote_antigo_so_l3: loteAntigoDoLead(r)?.so_l3 === true,
  };
}

/** v1.9.41: a marca do lote antigo no clone (`source_metadata.esteira_lote_antigo`). */
function loteAntigoDoLead(r: Pick<LinhaDeLead, "source_metadata">): { em?: unknown; so_l3?: unknown } | null {
  const v = r.source_metadata?.esteira_lote_antigo;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as { em?: unknown; so_l3?: unknown }) : null;
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
      // Pacote de defeitos (D2): PAGINADO, em ordem de id, até a página vir
      // vazia. Era um `.limit(2000)` sem ordem: acima do teto de linhas do
      // PostgREST (`max_rows`, que não se mede daqui), uma parte dos leads nunca
      // chegava à esteira — e nunca ia ao follow-up. Parar na página VAZIA (e não
      // na página "incompleta") funciona com qualquer `max_rows`.
      const linhas = await todasAsPaginas<LinhaDeLead>((de, ate) =>
        admin
          .from("crm_leads")
          .select("id, contact_id, stage_id, created_at, owner_user_id, source_metadata")
          .eq("organization_id", orgId)
          .eq("pipeline_id", pipelineId)
          .eq("status", "open")
          .order("id", { ascending: true })
          .range(de, ate),
      );
      return linhas.map(paraLeadDaEsteira);
    },

    async passadosDoLoteAntigoDesde(desde) {
      // Clones do follow-up marcados a partir de `desde` (a marca é ISO em UTC, então comparar texto vale).
      const { count, error } = await admin
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .gte("source_metadata->esteira_lote_antigo->>em", desde.toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async passarParaFollowup(lead, etapaId, loteAntigo) {
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
      const clone = r.clone as LinhaDeLead & { sdr_user_id?: string | null };
      const metadata = {
        ...(clone.source_metadata ?? {}),
        esteira_inicio: lead.inicio,
        // v1.9.41: a marca do lote antigo (a cota do dia conta por ela; o "só L3" mora aqui).
        ...(loteAntigo ? { esteira_lote_antigo: { em: agora().toISOString(), so_l3: loteAntigo.soL3 } } : {}),
      };
      // v1.9.4 (Rodrigo, 27/10): no follow-up o dono é o GUARDIÃO (o SDR), não o
      // vendedor que estava com o lead. O clone herda o guardião (gatilho 0579).
      const { data: comGuardiao, error: erroDoGuardiao } = await admin
        .from("crm_leads")
        .select("sdr_user_id")
        .eq("organization_id", orgId)
        .eq("id", clone.id)
        .maybeSingle();
      // v1.9.52 (0634, CRM-254 a/b): o dono no Follow-up é o SDR DE FOLLOW-UP da vez (rodízio entre os ativos), e as
      // ligações L3-L7 vêm junto (vão para o dono). Sem nenhum SDR de Follow-up ativo, a regra de antes: o guardião;
      // no lote antigo sem guardião, o dono do rodízio. O guardião (sdr_user_id) do clone NÃO é mexido aqui.
      const { data: daVez, error: erroDaVez } = await admin.rpc("fn_iavek_sdr_followup_da_vez" as never, {
        p_org: orgId,
        p_lead: clone.id,
      } as never);
      if (erroDaVez) logger.warn("esteira_sdr_followup_da_vez_falhou", { organization_id: orgId, lead_id: clone.id, codigo: erroDaVez.code ?? null });
      const sdrDeFollowup = typeof daVez === "string" ? daVez : null;
      // v1.9.41: no lote antigo, sem guardião, o dono é o do rodízio (nunca fica sem dono).
      const guardiao =
        sdrDeFollowup ?? (comGuardiao as { sdr_user_id: string | null } | null)?.sdr_user_id ?? loteAntigo?.dono ?? null;
      const { error: erroDoClone } = await admin
        .from("crm_leads")
        .update({
          source_metadata: metadata,
          ...(guardiao ? { owner_user_id: guardiao, owner_kind: "user", owner_agent_id: null } : {}),
        })
        .eq("organization_id", orgId)
        .eq("id", clone.id);
      // ia.vek v1.9.14: o lead já passou; sem isto ficava sem dono e sem relógio em silêncio.
      if (erroDoGuardiao || erroDoClone) {
        logger.error("esteira_followup_incompleto", {
          organization_id: orgId,
          lead_id: clone.id,
          erro: (erroDoGuardiao ?? erroDoClone)?.message,
          // (Lupa 153805) a vez do SDR de Follow-up já foi registrada pela 0630: com o update falhando, ela fica gasta
          // sem lead. Inofensivo (uma vez fora da ordem), mas o log diz qual, para a contagem do rodízio não confundir.
          ...(sdrDeFollowup ? { vez_gasta_sem_lead: sdrDeFollowup } : {}),
        });
      }
      if (guardiao) clone.owner_user_id = guardiao;
      // ia.vek v1.9.52.3 (regra do Rodrigo 13/11 ~22:55Z; Maestro 225419/232223/232320; Lupa 225428/232234): com um SDR
      // DE FOLLOW-UP ativo, o lead que passa a ele SOME para o vendedor e o SDR de antes. Sem SDR de Follow-up, nada muda.
      if (sdrDeFollowup) await entregarAoSdrDeFollowup(admin, ctx, orgId, { originalId: lead.id, cloneId: clone.id, contactId: lead.contact_id ?? null }, sdrDeFollowup);

      // ia.vek v1.9.37 (CRM-229): o clone também procura o CARRO DO ANÚNCIO. Ele copia os campos do
      // original, e o original que nasceu antes da v1.9.32 não tinha carro: 29 dos 40 leads de anúncio
      // sem carro eram clones assim (medido em 07/11). Nunca pisa num carro já gravado e nunca
      // derruba a passagem: o lead já está no Follow-up e é o que importa.
      if (lead.contact_id) {
        try {
          const { data: contato } = await admin
            .from("contacts")
            .select("source_metadata")
            .eq("organization_id", orgId)
            .eq("id", lead.contact_id)
            .maybeSingle();
          const desfecho = await gravarCarroDoAnuncio(
            admin,
            orgId,
            clone.id,
            (contato as { source_metadata?: unknown } | null)?.source_metadata,
          );
          registrarDesfechoDoCarro("clone_da_esteira", orgId, clone.id, desfecho);
        } catch (err) {
          registrarDesfechoDoCarro("clone_da_esteira", orgId, clone.id, "erro", err);
        }
      }

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

    async perderSemRetorno(lead, motivo) {
      // CRM-141: a etapa de perda do funil DO lead (uma só por funil, `uniq_crm_stages_pipeline_lost`),
      // pelo mesmo escritor de etapa da tela, com o motivo na mesma escrita.
      try {
        const { data: atual, error: e1 } = await admin
          .from("crm_stages")
          .select("pipeline_id")
          .eq("organization_id", orgId)
          .eq("id", lead.stage_id)
          .maybeSingle();
        if (e1 || !atual) throw new Error(e1?.message ?? "etapa_atual_nao_achada");
        const { data: perda, error: e2 } = await admin
          .from("crm_stages")
          .select("id")
          .eq("organization_id", orgId)
          .eq("pipeline_id", (atual as { pipeline_id: string }).pipeline_id)
          .eq("is_lost", true)
          .eq("is_archived", false)
          .maybeSingle();
        if (e2 || !perda) throw new Error(e2?.message ?? "funil_sem_etapa_de_perda");
        await moveLeadHandler(admin, ctx, lead.id, {
          to_stage_id: (perda as { id: string }).id,
          reason: "Esteira: terminou todas as fases do follow-up sem retorno",
          lost_reason: motivo,
        });
        return true;
      } catch (err) {
        logger.warn("esteira_sem_retorno_falhou", {
          organization_id: orgId,
          lead_id: lead.id,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        return false;
      }
    },

    async comHandoff(leadIds) {
      if (leadIds.length === 0) return new Set();
      // v1.9.19.2: em lotes e conferindo o erro. Um erro aqui virava "ninguém tem" em silêncio.
      const { data, error } = await buscaEmLotes(leadIds, (lote) =>
        admin
          .from("crm_lead_activities")
          .select("lead_id")
          .eq("organization_id", orgId)
          .eq("type", "handoff_triggered")
          .in("lead_id", lote),
      );
      if (error) throw new Error(error.message);
      return new Set((data as Array<{ lead_id: string }>).map((r) => r.lead_id));
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

    async reativar(lead) {
      const completo = await lerLeadDaPassagem(admin, orgId, lead.id);
      if (!completo) return null;
      const r = await reativarLead(admin, ctx, completo, {
        atorId: null,
        motivo: "O cliente voltou a falar no WhatsApp durante o follow-up",
      });
      if (!r.ok) {
        logger.warn("esteira_reativar_falhou", { organization_id: orgId, lead_id: lead.id, code: r.erro });
        return null;
      }
      const novo = await lerLeadDaPassagem(admin, orgId, r.novoLeadId);
      return novo ? paraLeadDaEsteira(novo as unknown as LinhaDeLead) : null;
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
      // v1.9.19.2: um erro aqui viraria "nenhuma ligação criada", e a rodada repetiria ligações.
      const { data, error } = await buscaEmLotes(leadIds, (lote) =>
        admin
          .from("crm_tasks")
          .select("lead_id, source_kind")
          .eq("organization_id", orgId)
          .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
          .in("lead_id", lote),
      );
      if (error) throw new Error(error.message);
      for (const r of data as Array<{ lead_id: string; source_kind: string }>) {
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
      const { data, error } = await lerTudo((de, ate) =>
        admin
          .from("crm_tasks")
          .select("id, lead_id, contact_id, title, due_date, assigned_to")
          .eq("organization_id", orgId)
          .in("status", ["pending", "in_progress"])
          .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
          .not("lead_id", "is", null)
          .lt("due_date", antesDe.toISOString())
          .order("id")
          .range(de, ate),
      );
      if (error) throw new Error(error.message);
      return data as LigacaoPendente[];
    },

    async cobrancasFeitas(tarefaIds) {
      const mapa = new Map<string, Set<number>>();
      if (tarefaIds.length === 0) return mapa;
      // ia.vek v1.9.42 (11/11): só os pares DISTINTOS (tarefa, nível), direto no banco. Antes vinham pela
      // API TODAS as atividades de cobrança das tarefas, e a resposta era cortada no max_rows do
      // PostgREST: tarefa fora do corte parecia "nunca cobrada", era cobrada de novo e gerava mais linhas
      // (408 mil cobranças repetidas, medido em 11/11). Um erro aqui DERRUBA a rodada (throw): é melhor
      // não cobrar ninguém numa rodada do que cobrar todo mundo de novo.
      const { rows } = await getRequestPool().query(
        `select distinct source_id::text as task_id, (payload->>'nivel')::int as nivel
           from crm_lead_activities
          where organization_id = $1 and type = 'esteira_ligacao_cobrada'
            and source_id = any($2::uuid[]) and (payload->>'nivel') ~ '^[0-9]+$'`,
        [orgId, tarefaIds],
      );
      for (const r of rows as Array<{ task_id: string; nivel: number }>) {
        if (!mapa.has(r.task_id)) mapa.set(r.task_id, new Set());
        mapa.get(r.task_id)!.add(r.nivel);
      }
      return mapa;
    },

    async reconciliarFollowup(followupPipelineId) {
      // v1.9.52.3: idempotente; só com SDR de Follow-up ATIVO na org (sem ele, os conjuntos são vazios e nada muda).
      // Janela de 30 dias de clones, para a consulta ficar barata.
      const { rows } = await getRequestPool().query(
        `with sdrs as (
           select user_id from public.user_organizations
            where organization_id = $1 and revoked_at is null and role = 'agent' and interface_settings->>'funcao' = 'sdr_followup'),
         clones as (
           select c.id, c.owner_user_id, c.created_at from public.crm_leads c
            where c.organization_id = $1 and c.pipeline_id = $2 and c.owner_user_id in (select user_id from sdrs)
              and c.created_at > now() - interval '30 days'),
         g as (
           update public.crm_leads c set sdr_user_id = c.owner_user_id
             from clones k where c.id = k.id and c.sdr_user_id is distinct from c.owner_user_id returning c.id),
         o as (
           update public.crm_leads x set owner_user_id = k.owner_user_id, owner_kind = 'user', owner_agent_id = null, sdr_user_id = k.owner_user_id
             from clones k
            where x.organization_id = $1 and x.status = 'lost' and x.lost_reason = 'moved_to_another_pipeline'
              and x.source_metadata->'movido_para'->>'lead_id' = k.id::text
              and (x.owner_user_id is distinct from k.owner_user_id or x.sdr_user_id is distinct from k.owner_user_id)
           returning x.id),
         -- (Lupa 050818, Maestro 050832) as TAREFAS dos 2 leads (o clone e o original) com outra pessoa, menos as 'done':
         -- é a tarefa que abre o contato a quem a tem (fn_iavek_contatos_do_vendedor), então uma falha no passo (d) da
         -- passagem não pode ficar calada.
         t as (
           update public.crm_tasks tk set assigned_to = k.owner_user_id
             from clones k
            where tk.organization_id = $1 and tk.status <> 'done'
              and tk.assigned_to is not null and tk.assigned_to is distinct from k.owner_user_id
              -- (Lupa 051624, Maestro 051636) SÓ as tarefas que JÁ EXISTIAM na passagem (o clone nasce nela). A tarefa
              -- criada DEPOIS é de quem a pessoa quis (o SDR de Follow-up ou o gerente pode DELEGAR a um vendedor).
              and tk.created_at <= k.created_at
              and (tk.lead_id = k.id
                   or tk.lead_id in (select x2.id from public.crm_leads x2
                                      where x2.organization_id = $1 and x2.status = 'lost'
                                        and x2.lost_reason = 'moved_to_another_pipeline'
                                        and x2.source_metadata->'movido_para'->>'lead_id' = k.id::text))
           returning tk.id)
         select (select count(*) from g)::int as guardioes, (select count(*) from o)::int as originais,
                (select count(*) from t)::int as tarefas`,
        [orgId, followupPipelineId],
      );
      const r = (rows[0] ?? { guardioes: 0, originais: 0, tarefas: 0 }) as { guardioes: number; originais: number; tarefas: number };
      const conversas = await reconciliarConversasDoFollowup(admin, orgId, followupPipelineId, ctx);
      if (r.guardioes + r.originais + r.tarefas + conversas > 0) {
        // A saúde lê esta linha: > 0 = AMARELO (a entrega da passagem falhou em algum ponto e foi corrigida aqui).
        logger.warn("esteira_followup_reconciliados", { organization_id: orgId, guardioes: r.guardioes, originais: r.originais, tarefas: r.tarefas, conversas });
      }
      return { guardioes: r.guardioes, originais: r.originais, tarefas: r.tarefas, conversas };
    },

    async cobrar(tarefa, nivel, destinatario) {
      await cobrarLigacao(admin, orgId, tarefa, nivel, destinatario);
    },
  };
}

/**
 * ia.vek v1.9.52.3: entrega o lead passado das 72h ao SDR DE FOLLOW-UP por inteiro, para o vendedor (A) e o SDR (B) de
 * antes deixarem de vê-lo:
 *  a. o CLONE (Follow-up): o guardião (sdr_user_id) também vira o SDR de Follow-up (o dono já virou acima);
 *  b. o ORIGINAL fechado (72h, 'moved_to_another_pipeline', que o Meus números não conta como perda): dono E guardião
 *     viram o SDR de Follow-up (decidido: o simples; Maestro 232320);
 *  c. a CONVERSA do contato segue o novo dono pela regra de sempre (`conversaSegueODono`: só a que está com uma
 *     PESSOA; a que a IA atende fica como está, para não calar a IA);
 *  d. as TAREFAS dos 2 leads que estão com outra pessoa (menos as 'done') passam ao SDR de Follow-up.
 * Nunca derruba a passagem (o lead já está no Follow-up): erro vai ao log, com o passo.
 */
const MOTIVO_DA_CONVERSA_SEM_IA = "Conversa sem atendente passada ao SDR de Follow-up (a loja não tem atendimento automático no ar)";
const MOTIVO_DA_REABERTA = "Conversa reaberta sem dono devolvida ao SDR de Follow-up do lead (a loja não tem atendimento automático no ar)";

/**
 * ia.vek v1.9.52.4 (Maestro 072000/072027, Lupa 071958): a conversa que FICOU SEM DONO (a reabertura de uma conversa
 * fechada zera o dono no banco: fn_service_stamp_status; medido no canário em 14/11) de um contato cujo lead ABERTO no
 * Follow-up é de um SDR de Follow-up ATIVO volta para esse SDR, a cada rodada. Só quando a org NÃO tem atendimento
 * automático no ar (`orgTemAutomatico === false`; indefinido = tem, não mexe: com IA, a conversa sem dono é da IA).
 * Não mexe em: conversa com dono (a 'claimed' de outra pessoa), conversa com IA ativa (active_ai_agent_id), conversa
 * fechada, contato sem lead aberto no Follow-up. No máximo 200 por rodada. Devolve quantas passou.
 */
async function reconciliarConversasDoFollowup(
  admin: SupabaseClient,
  orgId: string,
  followupPipelineId: string,
  ctx: HandlerCtx,
): Promise<number> {
  if ((await orgTemAutomatico(admin, orgId)) !== false) return 0;
  const { rows } = await getRequestPool().query(
    `with sdrs as (
       select user_id from public.user_organizations
        where organization_id = $1 and revoked_at is null and role = 'agent' and interface_settings->>'funcao' = 'sdr_followup'),
     abertos as (
       select distinct on (c.contact_id) c.contact_id, c.owner_user_id from public.crm_leads c
        where c.organization_id = $1 and c.pipeline_id = $2 and c.status = 'open' and c.contact_id is not null
          and c.owner_user_id in (select user_id from sdrs)
        order by c.contact_id, c.created_at desc)
     select distinct a.contact_id, a.owner_user_id from public.conversations v
       join abertos a on a.contact_id = v.contact_id
      where v.organization_id = $1 and not v.is_group
        and v.assigned_to_user_id is null and v.active_ai_agent_id is null
        and v.status not in ('closed', 'resolved', 'archived')
      limit 200`,
    [orgId, followupPipelineId],
  );
  let passadas = 0;
  for (const linha of rows as Array<{ contact_id: string; owner_user_id: string }>) {
    try {
      await passarAConversa(admin, { orgId, contactId: linha.contact_id, para: linha.owner_user_id, actor: ctx.actor, motivo: MOTIVO_DA_REABERTA });
      passadas++;
    } catch (e) {
      logger.error("esteira_followup_conversa_falhou", { organization_id: orgId, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return passadas;
}

async function entregarAoSdrDeFollowup(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  orgId: string,
  ids: { originalId: string; cloneId: string; contactId: string | null },
  sdr: string,
): Promise<void> {
  const passo = async (nome: string, f: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await f();
      if (error) logger.error("esteira_followup_entrega_falhou", { organization_id: orgId, lead_id: ids.cloneId, passo: nome, erro: error.message });
    } catch (e) {
      logger.error("esteira_followup_entrega_falhou", { organization_id: orgId, lead_id: ids.cloneId, passo: nome, erro: e instanceof Error ? e.message : String(e) });
    }
  };
  await passo("guardiao_do_clone", () =>
    admin.from("crm_leads").update({ sdr_user_id: sdr }).eq("organization_id", orgId).eq("id", ids.cloneId),
  );
  await passo("original", () =>
    admin
      .from("crm_leads")
      .update({ owner_user_id: sdr, owner_kind: "user", owner_agent_id: null, sdr_user_id: sdr })
      .eq("organization_id", orgId)
      .eq("id", ids.originalId),
  );
  await passo("tarefas", () =>
    admin
      .from("crm_tasks")
      .update({ assigned_to: sdr })
      .eq("organization_id", orgId)
      .in("lead_id", [ids.originalId, ids.cloneId])
      // (Maestro 050721, prova 05:05Z) também as CANCELADAS: o gatilho do lead fechado cancela as do original ANTES
      // deste passo, e a cancelada com A/B dava a eles a tarefa E o contato (fn_iavek_contatos_do_vendedor olha a
      // tarefa de qualquer status). Só as 'done' ficam com quem fez. Só o assigned_to muda.
      .neq("status", "done")
      .not("assigned_to", "is", null)
      .neq("assigned_to", sdr),
  );
  try {
    const seguiu = await conversaSegueODono(admin, { orgId, contactId: ids.contactId, novoDono: sdr, actor: ctx.actor });
    // (Maestro 002322, Lupa 002339) a conversa SEM dono: vai ao SDR de Follow-up SÓ se a org NÃO tem atendimento
    // automático no ar, pela MESMA função que a Fila e as contagens usam (`orgTemAutomatico`). Indefinido (não deu para
    // saber) conta como "tem": não mexe (não cala uma IA que pode estar atendendo).
    if (!seguiu && ids.contactId) {
      const { data: conversa } = await admin
        .from("conversations")
        .select("assigned_to_user_id")
        .eq("organization_id", orgId)
        .eq("contact_id", ids.contactId)
        .eq("is_group", false)
        .neq("status", "archived")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (conversa && (conversa as { assigned_to_user_id: string | null }).assigned_to_user_id == null) {
        const temIa = await orgTemAutomatico(admin, orgId);
        if (temIa === false) {
          await passarAConversa(admin, { orgId, contactId: ids.contactId, para: sdr, actor: ctx.actor, motivo: MOTIVO_DA_CONVERSA_SEM_IA });
        } else if (temIa === undefined) {
          // (Lupa 003315) para saber se o caminho "não deu para saber" aparece na produção
          logger.warn("conversa_sem_dono_ficou", { organization_id: orgId, lead_id: ids.cloneId, motivo: "org_sem_resposta_de_ia_definida" });
        }
      }
    }
  } catch (e) {
    logger.error("esteira_followup_entrega_falhou", { organization_id: orgId, lead_id: ids.cloneId, passo: "conversa", erro: e instanceof Error ? e.message : String(e) });
  }
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
