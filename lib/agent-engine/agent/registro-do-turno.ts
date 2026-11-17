/**
 * ia.vek v1.9.60 (0646, CRM-491): UM REGISTRO POR TURNO RESPONDIDO, para conferir depois.
 *
 * Grava ligações e fatos, nunca o texto do cliente: o job (que liga às llm_calls pelo job_id), a conversa, o contato, a
 * mensagem que o turno respondeu, as mensagens que saíram, o agente, a versão PUBLICADA do prompt, o modelo e o nível
 * final de manipulação. Chamado no fim do turno que respondeu (inbound-turn.ts). NUNCA lança: o turno já respondeu, e o
 * registro é para acompanhar.
 */
import type pg from 'pg';

import type { Logger } from '../obs/logger';
import type { ChannelSendResult } from '../channel-adapter';

export interface RegistroDoTurno {
  organizationId: string;
  jobId: string | null;
  kind: string | null;
  conversationId: string | null;
  contactId: string | null;
  inboundMessageId: string | null;
  outcomes: readonly ChannelSendResult[];
  agentId: string | null;
  agentVersionId: string | null;
  modelo: string | null;
  nivelManipulacao: 'none' | 'low' | 'high' | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null | undefined): string | null => (v && UUID.test(v) ? v : null);

/** Os ids das mensagens que SAÍRAM (enviadas agora ou já aceitas no replay). Os outros desfechos não têm mensagem. */
export function mensagensEnviadas(outcomes: readonly ChannelSendResult[]): string[] {
  const ids: string[] = [];
  for (const o of outcomes) {
    if ((o.kind === 'sent' || o.kind === 'already_sent') && o.messageId && UUID.test(o.messageId)) ids.push(o.messageId);
  }
  return ids;
}

export async function registrarTurnoDaIa(pool: Pick<pg.Pool, 'query'>, r: RegistroDoTurno, log: Logger): Promise<void> {
  try {
    await pool.query(
      `insert into iavek_turnos_da_ia
         (organization_id, job_id, kind, conversation_id, contact_id, inbound_message_id, mensagens_enviadas,
          agent_id, agent_version_id, modelo, nivel_manipulacao)
       values ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11)`,
      [
        r.organizationId,
        uuidOuNulo(r.jobId),
        r.kind ? r.kind.slice(0, 40) : null,
        uuidOuNulo(r.conversationId),
        uuidOuNulo(r.contactId),
        uuidOuNulo(r.inboundMessageId),
        mensagensEnviadas(r.outcomes),
        uuidOuNulo(r.agentId),
        uuidOuNulo(r.agentVersionId),
        r.modelo ? r.modelo.slice(0, 120) : null,
        r.nivelManipulacao,
      ],
    );
  } catch (err) {
    log.warn('registro do turno da IA falhou (best-effort)', {
      error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
    });
  }
}
