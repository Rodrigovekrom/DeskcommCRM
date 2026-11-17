/**
 * ia.vek v1.9.60 (CRM-460): SE A IA CAIR, A CONVERSA VAI PARA UMA PESSOA.
 *
 * O defeito (CÓDIGO, 17/11): o job do turno da IA que esgota as tentativas vira `dead` (`failJob`,
 * lib/agent-engine/queue/queue.ts) com um aviso crítico na Central, e a conversa fica COM A IA. O cliente que escreveu
 * fica sem resposta, e nada põe uma pessoa na conversa: o aviso da Central diz que um job morreu, não que alguém
 * está esperando.
 *
 * O que este módulo faz, chamado pelo worker logo depois do `failJob` que devolveu `dead`:
 *   1. só para os turnos que respondem a um cliente (`inbound_turn`, `followup_turn`, `case_reply_turn`), com contato;
 *   2. acha a conversa (a do payload; senão a mais recente do contato na organização);
 *   3. se a organização LIGOU o aviso (`settings.iavek.ia_caiu.avisar_cliente === true`; DESLIGADO por padrão), avisa o
 *      cliente com o texto fixo de passagem (sem gastar token: o motivo é justamente a IA ter falhado);
 *   4. faz a passagem para a fila humana (`performHumanHandoff`, o mesmo caminho do teto de gasto), com origem e motivo
 *      `falha_da_ia` (0645) e o resumo do checkpoint durável.
 *
 * NUNCA lança: o job já morreu e a Central já tem o aviso dele; uma falha aqui fica no log e não piora nada.
 */
import type pg from 'pg';

import { montarBriefingDaPassagem, type BriefingDaPassagem } from '@/lib/escalacao/briefing-da-passagem';
import type { Logger } from '../obs/logger';
import type { JobRow } from '../queue/queue';
import type { DesfechoDoAviso } from './aviso-de-escalacao';
import { performHumanHandoff } from './human-handoff';
import { latestCheckpoint } from './inbound-turn';

/** Os turnos que respondem a um cliente. O `operator_turn` é retaguarda: o cliente já foi respondido. */
export const TURNOS_QUE_RESPONDEM = new Set<string>(['inbound_turn', 'followup_turn', 'case_reply_turn']);

export const HANDOFF_REASON_FALHA_DA_IA = 'falha_da_ia';
export const TITULO_DA_PASSAGEM_POR_FALHA = 'A IA falhou ao responder — uma pessoa precisa assumir';
/** Vai NA FRENTE do resumo: diz a quem assume que o cliente NÃO pediu uma pessoa. */
export const RESUMO_DA_PASSAGEM_POR_FALHA =
  'A IA falhou ao responder esta conversa (erro do sistema, depois de várias tentativas). O cliente não pediu uma pessoa: ' +
  'leia a última mensagem dele e responda.';

/** Ausente ou qualquer coisa diferente de `true` = desligado (o padrão). */
export function avisoAoClienteLigado(settings: unknown): boolean {
  const ia = (settings as { iavek?: { ia_caiu?: { avisar_cliente?: unknown } } } | null)?.iavek?.ia_caiu;
  return ia?.avisar_cliente === true;
}

export type DesfechoDaPassagemPorFalha =
  | 'passou'
  | 'nao_e_turno'
  | 'nao_morreu'
  | 'sem_contato'
  | 'sem_conversa'
  | 'erro';

export interface DepsDaPassagemPorFalha {
  log: Logger;
  /** Avisa o cliente (só chamado com o aviso LIGADO na organização). */
  avisarCliente?: (ids: {
    tenantId: string;
    leadId: string;
    conversationId: string;
    channelSessionId: string;
    jobId: string;
  }) => Promise<DesfechoDoAviso>;
  /** Para teste: o handoff e o checkpoint de verdade por padrão. */
  handoff?: typeof performHumanHandoff;
  checkpoint?: typeof latestCheckpoint;
}

export async function passarAoHumanoPorFalha(
  pool: pg.Pool,
  job: Pick<JobRow, 'id' | 'kind' | 'status' | 'organization_id' | 'contact_id' | 'payload'>,
  deps: DepsDaPassagemPorFalha,
): Promise<DesfechoDaPassagemPorFalha> {
  if (!TURNOS_QUE_RESPONDEM.has(job.kind)) return 'nao_e_turno';
  if (job.status !== 'dead') return 'nao_morreu';
  const leadId = job.contact_id;
  if (!leadId) return 'sem_contato';
  const tenantId = job.organization_id;
  try {
    const doPayload = (job.payload as { conversation_id?: unknown } | null)?.conversation_id;
    const { rows: convs } = await pool.query<{ id: string; channel_session_id: string | null }>(
      typeof doPayload === 'string'
        ? 'select id, channel_session_id from conversations where organization_id = $1 and contact_id = $2 and id = $3'
        : 'select id, channel_session_id from conversations where organization_id = $1 and contact_id = $2 order by last_message_at desc nulls last limit 1',
      typeof doPayload === 'string' ? [tenantId, leadId, doPayload] : [tenantId, leadId],
    );
    const conversa = convs[0];
    if (!conversa) return 'sem_conversa';

    let avisoAoLead: DesfechoDoAviso | undefined;
    const { rows: orgs } = await pool.query<{ settings: unknown }>('select settings from organizations where id = $1', [tenantId]);
    if (avisoAoClienteLigado(orgs[0]?.settings) && deps.avisarCliente && conversa.channel_session_id) {
      try {
        avisoAoLead = await deps.avisarCliente({
          tenantId,
          leadId,
          conversationId: conversa.id,
          channelSessionId: conversa.channel_session_id,
          jobId: job.id,
        });
      } catch (err) {
        deps.log.warn('passagem por falha: o aviso ao cliente falhou, a passagem segue', {
          error: err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido',
        });
        avisoAoLead = { avisado: false, porque: 'erro_no_envio' };
      }
    }

    let doCheckpoint: BriefingDaPassagem;
    try {
      doCheckpoint = montarBriefingDaPassagem({
        checkpoint: await (deps.checkpoint ?? latestCheckpoint)(pool, tenantId, leadId),
        motivo: { codigo: 'falha_da_ia' },
      });
    } catch {
      doCheckpoint = montarBriefingDaPassagem({ checkpoint: null, motivo: { codigo: 'falha_da_ia' } });
    }
    const briefing: BriefingDaPassagem = { ...doCheckpoint, body: `${RESUMO_DA_PASSAGEM_POR_FALHA}\n\n${doCheckpoint.body}` };

    await (deps.handoff ?? performHumanHandoff)(
      pool,
      { tenantId, leadId, conversationId: conversa.id },
      {
        reason: HANDOFF_REASON_FALHA_DA_IA,
        conversationSummary: briefing.body,
        inboxTitle: TITULO_DA_PASSAGEM_POR_FALHA,
        passagem: { origem: 'falha_da_ia', motivoCodigo: 'falha_da_ia', briefing },
        ...(avisoAoLead ? { avisoAoLead } : {}),
        log: deps.log,
      },
    );
    deps.log.warn('turno da IA morreu — conversa devolvida à fila humana', {
      job_id: job.id,
      kind: job.kind,
      cliente_avisado: avisoAoLead?.avisado ?? false,
    });
    return 'passou';
  } catch (err) {
    deps.log.error('passagem por falha não pôde ser feita (o aviso job_dead segue na Central)', {
      job_id: job.id,
      error: err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido',
    });
    return 'erro';
  }
}

/**
 * O que o worker chama depois do `failJob`: relê o job e, se ele MORREU, faz a passagem. A releitura existe porque o
 * roteamento `cancelJob`/`failJob` do worker é vigiado letra por letra (tests/unit/handoff-por-orcamento.test.ts) e não
 * deve mudar; o custo é uma leitura, só no caminho de falha. Nunca lança.
 */
export async function passarAoHumanoSeOJobMorreu(
  pool: pg.Pool,
  jobId: string,
  deps: DepsDaPassagemPorFalha,
): Promise<DesfechoDaPassagemPorFalha> {
  try {
    const { rows } = await pool.query<Pick<JobRow, 'id' | 'kind' | 'status' | 'organization_id' | 'contact_id' | 'payload'>>(
      `select id, kind, status, organization_id, contact_id, payload from job_queue where id = $1 and status = 'dead'`,
      [jobId],
    );
    const job = rows[0];
    if (!job) return 'nao_morreu';
    return await passarAoHumanoPorFalha(pool, job, deps);
  } catch (err) {
    deps.log.error('passagem por falha: o job não pôde ser relido', {
      job_id: jobId,
      error: err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido',
    });
    return 'erro';
  }
}
