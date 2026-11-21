/**
 * Os fios da esteira (ia.vek D3): cada operação de `DepsDaEsteira` pelo MESMO
 * caminho que a tela usa — a passagem das 72h MOVE o mesmo lead (v1.9.62, CRM-497), mover pelo
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
import { encerraDemanda } from "@/lib/leads/encerramento";
import { MOTIVO_DA_TRANSFERENCIA } from "@/lib/leads/motivo-da-perda";
import { logger } from "@/lib/logger";
import { buscaEmLotes } from "@/lib/supabase/em-lotes";
import { lerTudo, todasAsPaginas } from "@/lib/supabase/paginas";
import { manterAteDoLead, nascimentoDoLead } from "@/lib/iavek/cronometro-72h";
import { SQL_RECONCILIAR_FOLLOWUP } from "@/lib/esteira/reconciliar-followup-sql";
import { preservadasNaPassagem } from "@/lib/iavek/regras-da-passagem";
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

/** v1.9.62 (CRM-497, D4): os motivos das tarefas canceladas na passagem das 72h (crm_tasks.cancelada_motivo). */
export const MOTIVO_DA_PASSAGEM_72H = "passou_ao_followup";
export const MOTIVO_SEM_REVISAO = "passagem_sem_revisao";
const NOTA_DA_PASSAGEM = "Passou para o Follow-up: venceram as 72h na entrada, sem perda marcada";

type LinhaDeLead = {
  id: string;
  contact_id: string | null;
  stage_id: string;
  created_at: string;
  owner_user_id: string | null;
  source_metadata: Record<string, unknown> | null;
  /** v1.9.62 (0647, CRM-497): quando passou ao Follow-up (o mesmo lead, sem clone). */
  esteira_passou_em?: string | null;
};

function paraLeadDaEsteira(r: LinhaDeLead): LeadDaEsteira {
  return {
    id: r.id,
    contact_id: r.contact_id,
    stage_id: r.stage_id,
    created_at: r.created_at,
    owner_user_id: r.owner_user_id,
    passou_em: r.esteira_passou_em ?? null,
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

/** v1.9.62: `quando` é depois de `desde`? Sem `desde`, sempre (conta tudo, como antes). */
function depoisDe(quando: string, desde: string | undefined): boolean {
  return desde === undefined || Date.parse(quando) > Date.parse(desde);
}

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
          .select("id, contact_id, stage_id, created_at, owner_user_id, source_metadata, esteira_passou_em")
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
      // ia.vek v1.9.62 (CRM-497, "sempre um cartão só"; desenho v5 7fe7db2f + v6 8201d8ce, Lupa): a passagem MOVE o
      // MESMO lead para o Follow-up, numa escrita só (funil, etapa, dono, guardião, a data da passagem e o rastro).
      // Era o clone da tela (clonarLeadParaFunil). A P-01 (a API recusa trocar pipeline_id) FICA para a pessoa;
      // só a esteira, no servidor, move.
      const { data: etapa } = await admin
        .from("crm_stages")
        .select("pipeline_id")
        .eq("organization_id", orgId)
        .eq("id", etapaId)
        .maybeSingle();
      if (!etapa) return { ok: false, erro: "etapa_do_followup_nao_existe" };
      const destino = (etapa as { pipeline_id: string }).pipeline_id;
      const { data: atual, error: erroDaLeitura } = await admin
        .from("crm_leads")
        .select("id, contact_id, pipeline_id, stage_id, status, created_at, owner_user_id, sdr_user_id, source_metadata, esteira_passou_em")
        .eq("organization_id", orgId)
        .eq("id", lead.id)
        .maybeSingle();
      if (erroDaLeitura) return { ok: false, erro: "leitura_do_lead" };
      const linha = atual as
        | (LinhaDeLead & { pipeline_id: string; status: string; sdr_user_id: string | null })
        | null;
      if (!linha || linha.status !== "open") return { ok: false, erro: "lead_nao_esta_aberto" };
      if (linha.pipeline_id === destino) return { ok: false, erro: "ja_esta_no_followup" };
      // v1.9.52 (0634, CRM-254 a/b): o dono no Follow-up é o SDR DE FOLLOW-UP da vez (rodízio entre os ativos), e as
      // ligações L3-L7 vêm junto (vão para o dono). Sem nenhum SDR de Follow-up ativo, a regra de antes: o guardião;
      // no lote antigo sem guardião, o dono do rodízio; senão fica o dono de agora.
      const { data: daVez, error: erroDaVez } = await admin.rpc("fn_iavek_sdr_followup_da_vez" as never, {
        p_org: orgId,
        p_lead: lead.id,
      } as never);
      if (erroDaVez) logger.warn("esteira_sdr_followup_da_vez_falhou", { organization_id: orgId, lead_id: lead.id, codigo: erroDaVez.code ?? null });
      const sdrDeFollowup = typeof daVez === "string" ? daVez : null;
      const dono = sdrDeFollowup ?? linha.sdr_user_id ?? loteAntigo?.dono ?? linha.owner_user_id ?? null;
      const em = agora().toISOString();
      const anterior = linha.source_metadata ?? {};
      const metadata: Record<string, unknown> = {
        ...anterior,
        // Relógio B (decisão do Rodrigo, 17/11): segue contando do nascimento na entrada.
        esteira_inicio: lead.inicio,
        passagem: {
          em,
          de_pipeline: linha.pipeline_id,
          de_etapa: linha.stage_id,
          de_dono: linha.owner_user_id,
          venceu_72h: true,
        },
        // Uma 2ª passagem guarda a 1ª (a coluna regrava).
        ...(linha.esteira_passou_em ? { passagem_anterior: { em: linha.esteira_passou_em, ...(anterior.passagem as object | undefined) } } : {}),
        // v1.9.41: a marca do lote antigo (a cota do dia conta por ela; o "só L3" mora aqui).
        ...(loteAntigo ? { esteira_lote_antigo: { em, so_l3: loteAntigo.soL3 } } : {}),
      };
      // Uma escrita só, e SÓ se o lead ainda está onde a rodada o leu (aberto, no mesmo funil): outra escrita no
      // meio do caminho (a tela, outra rodada) não é atropelada.
      const escrita = admin
        .from("crm_leads")
        .update({
          pipeline_id: destino,
          stage_id: etapaId,
          esteira_passou_em: em,
          source_metadata: metadata,
          ...(dono ? { owner_user_id: dono, owner_kind: "user", owner_agent_id: null } : {}),
          // v1.9.52.3 (entregarAoSdrDeFollowup a.): com SDR de Follow-up, ele vira também o guardião.
          ...(sdrDeFollowup ? { sdr_user_id: sdrDeFollowup } : {}),
          ...(dono && dono !== linha.owner_user_id ? { assigned_at: em } : {}),
        })
        .eq("organization_id", orgId)
        .eq("id", lead.id)
        .eq("status", "open")
        .eq("pipeline_id", linha.pipeline_id);
      const { data: movido, error: erroDoMove } = await escrita.select("id").maybeSingle();
      if (erroDoMove || !movido) {
        logger.warn("esteira_passagem_recusada", {
          organization_id: orgId,
          lead_id: lead.id,
          code: erroDoMove?.code ?? "lead_mudou",
          ...(sdrDeFollowup ? { vez_gasta_sem_lead: sdrDeFollowup } : {}),
        });
        return { ok: false, erro: erroDoMove?.code ?? "lead_mudou" };
      }
      // D4 3A (Rodrigo, 21/11): a passagem SEM pessoa. As automáticas abertas (a régua) fecham com o motivo da
      // passagem e as de PESSOA com 'passagem_sem_revisao'; nenhuma é reatribuída (o novo dono recebe o lead limpo).
      try {
        const { data: canceladas, error: erroDasTarefas } = await admin.rpc("fn_iavek_tarefas_da_passagem" as never, {
          p_org: orgId,
          p_lead: lead.id,
          p_motivo_automaticas: MOTIVO_DA_PASSAGEM_72H,
          p_motivo_de_pessoa: MOTIVO_SEM_REVISAO,
          p_preservar: preservadasNaPassagem(),
          p_novo_dono: dono,
        } as never);
        if (erroDasTarefas) throw new Error(erroDasTarefas.message);
        logger.info("esteira_passagem_tarefas", { organization_id: orgId, lead_id: lead.id, ...(canceladas as object) });
      } catch (err) {
        // O lead já passou: falhar aqui não desfaz; a saúde lê esta linha.
        logger.error("esteira_passagem_tarefas_falhou", {
          organization_id: orgId,
          lead_id: lead.id,
          erro: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
      // A linha do tempo: a troca de etapa entre funis e a nota (o mesmo formato do move da tela).
      const linhaDoTempo = await emitLeadActivity(admin, {
        organizationId: orgId,
        leadId: lead.id,
        contactId: lead.contact_id,
        type: "stage_changed",
        sourceModule: "esteira",
        sourceId: lead.id,
        actor: ATOR_DA_ESTEIRA,
        reason: NOTA_DA_PASSAGEM,
        payload: {
          from_stage_id: linha.stage_id,
          to_stage_id: etapaId,
          from_pipeline_id: linha.pipeline_id,
          pipeline_id: destino,
          passagem_72h: true,
        },
      });
      if (!linhaDoTempo.ok) logger.warn("esteira_passagem_sem_linha_do_tempo", { organization_id: orgId, lead_id: lead.id, erro: linhaDoTempo.error });
      // ia.vek v1.9.52.3: com um SDR DE FOLLOW-UP ativo, a CONVERSA segue o novo dono (o dono e o guardião já
      // mudaram na escrita acima). Sem SDR de Follow-up, nada muda.
      if (sdrDeFollowup) await entregarAConversaAoSdrDeFollowup(admin, ctx, orgId, { leadId: lead.id, contactId: lead.contact_id ?? null }, sdrDeFollowup);
      const depois = { ...linha, pipeline_id: destino, stage_id: etapaId, owner_user_id: dono, esteira_passou_em: em };

      // ia.vek v1.9.37 (CRM-229): o lead que passa também procura o CARRO DO ANÚNCIO (o que nasceu antes da v1.9.32
      // não tinha carro). Nunca pisa num carro já gravado e nunca derruba a passagem: o lead já está no Follow-up.
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
            lead.id,
            (contato as { source_metadata?: unknown } | null)?.source_metadata,
          );
          registrarDesfechoDoCarro("clone_da_esteira", orgId, lead.id, desfecho);
        } catch (err) {
          registrarDesfechoDoCarro("clone_da_esteira", orgId, lead.id, "erro", err);
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
          // O lead já passou: falhar aqui não desfaz a passagem; o aviso fica no log.
          logger.warn("esteira_handoff_falhou", {
            organization_id: orgId,
            lead_id: lead.id,
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
      return { ok: true, lead: paraLeadDaEsteira({ ...depois, source_metadata: metadata }) };
    },

    async leadAbertoNoFollowup(contactId, followupPipelineId) {
      // ia.vek v1.9.59.2: o lead ABERTO do mesmo contato no funil de Follow-up (o mais antigo, se houver mais de um).
      const { data, error } = await admin
        .from("crm_leads")
        .select("id")
        .eq("organization_id", orgId)
        .eq("contact_id", contactId)
        .eq("pipeline_id", followupPipelineId)
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      // Um erro aqui não pode virar "não tem" em silêncio (seria outro clone): a rodada da loja para e avisa.
      if (error) throw new Error(error.message);
      return (data as { id: string } | null)?.id ?? null;
    },

    async fecharApontandoParaFollowup(lead, existenteId) {
      // ia.vek v1.9.59.2: a origem fecha COMO a passagem fecha (o mesmo `encerraDemanda` do clone, Perdido com
      // `moved_to_another_pipeline`, que não conta como perda), só que sem clone: o lead do Follow-up já existe.
      const NOTA = "Já tinha lead aberto no Follow-up; não clonou de novo";
      try {
        await encerraDemanda(admin, ctx, {
          leadId: lead.id,
          desfecho: "lost",
          motivo: MOTIVO_DA_TRANSFERENCIA,
          razaoNaTimeline: "Levado para o funil de Follow-up (já tinha lead aberto lá)",
          payloadNaTimeline: { lead_existente: existenteId },
        });
      } catch (err) {
        logger.warn("esteira_fechar_sem_clone_falhou", {
          organization_id: orgId,
          lead_id: lead.id,
          lead_existente: existenteId,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
        return false;
      }
      const nota = await emitLeadActivity(admin, {
        organizationId: orgId,
        leadId: lead.id,
        contactId: lead.contact_id,
        type: "note",
        sourceModule: "esteira",
        sourceId: existenteId,
        actor: ATOR_DA_ESTEIRA,
        reason: NOTA,
        payload: { lead_existente: existenteId },
      });
      if (!nota.ok) {
        // A origem já fechou: a nota perdida não desfaz nada, fica no log.
        logger.warn("esteira_nota_sem_clone_falhou", { organization_id: orgId, lead_id: lead.id, erro: nota.error });
      }
      return true;
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

    async comHandoff(leadIds, desdePorLead) {
      if (leadIds.length === 0) return new Set();
      // v1.9.19.2: em lotes e conferindo o erro. Um erro aqui virava "ninguém tem" em silêncio.
      const { data, error } = await buscaEmLotes(leadIds, (lote) =>
        admin
          .from("crm_lead_activities")
          .select("lead_id, created_at")
          .eq("organization_id", orgId)
          .eq("type", "handoff_triggered")
          .in("lead_id", lote),
      );
      if (error) throw new Error(error.message);
      // v1.9.62: só o handoff do ciclo de agora (o mesmo lead que voltou à entrada não herda o do ciclo anterior).
      return new Set(
        (data as Array<{ lead_id: string; created_at: string }>)
          .filter((r) => depoisDe(r.created_at, desdePorLead?.get(r.lead_id)))
          .map((r) => r.lead_id),
      );
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

    async ligacoesJaCriadas(leadIds, desdePorLead) {
      const mapa = new Map<string, Set<string>>();
      if (leadIds.length === 0) return mapa;
      // v1.9.19.2: um erro aqui viraria "nenhuma ligação criada", e a rodada repetiria ligações.
      const { data, error } = await buscaEmLotes(leadIds, (lote) =>
        admin
          .from("crm_tasks")
          .select("lead_id, source_kind, created_at")
          .eq("organization_id", orgId)
          .like("source_kind", `${PREFIXO_DE_LIGACAO}%`)
          .in("lead_id", lote),
      );
      if (error) throw new Error(error.message);
      for (const r of data as Array<{ lead_id: string; source_kind: string; created_at: string }>) {
        // v1.9.62 (CRM-497): só as do trecho de agora (o 2º ciclo do mesmo lead recomeça a régua).
        if (!depoisDe(r.created_at, desdePorLead?.get(r.lead_id))) continue;
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
      // v1.9.60.1: o SQL mora em reconciliar-followup-sql.ts (a parte das tarefas sem subconsulta correlacionada).
      const { rows } = await getRequestPool().query(
        SQL_RECONCILIAR_FOLLOWUP,
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
 * ia.vek v1.9.52.3, v1.9.62 (CRM-497): a CONVERSA do lead passado das 72h segue o SDR DE FOLLOW-UP. Desde a 62 o lead é
 * UM só (o dono e o guardião já mudaram na escrita da passagem), e as TAREFAS não são mais reatribuídas (D4 do Rodrigo:
 * as automáticas e as de pessoa abertas fecharam com motivo; o novo dono recebe o lead limpo). Fica só a conversa:
 * ela segue o novo dono pela regra de sempre (`conversaSegueODono`: só a que está com uma PESSOA; a que a IA atende
 * fica como está, para não calar a IA), e a conversa SEM dono vai ao SDR só se a org NÃO tem atendimento automático.
 * Nunca derruba a passagem (o lead já está no Follow-up): erro vai ao log.
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

async function entregarAConversaAoSdrDeFollowup(
  admin: SupabaseClient,
  ctx: HandlerCtx,
  orgId: string,
  ids: { leadId: string; contactId: string | null },
  sdr: string,
): Promise<void> {
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
          logger.warn("conversa_sem_dono_ficou", { organization_id: orgId, lead_id: ids.leadId, motivo: "org_sem_resposta_de_ia_definida" });
        }
      }
    }
  } catch (e) {
    logger.error("esteira_followup_entrega_falhou", { organization_id: orgId, lead_id: ids.leadId, passo: "conversa", erro: e instanceof Error ? e.message : String(e) });
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
