/**
 * ia.vek v1.9.60 (CRM-485): o BLOQUEIO da manipulação forte, por organização.
 *
 * O classificador (`./classifier.ts`) é advisório por construção: só marca o turno. Com
 * `organizations.settings.iavek.manipulacao.bloquear_no_alto === true`, o turno cujo nível final é `high` não responde:
 * a resposta fica segurada e a conversa vai para uma pessoa (inbound-turn.ts). DESLIGADO por padrão (ausente, ou
 * qualquer coisa diferente de `true`). A leitura só acontece quando o nível já deu `high`, então o caminho comum não
 * paga nada. Nunca lança: sem leitura, vale o desligado (o comportamento de antes).
 */
import type pg from 'pg';

export function bloqueioLigadoNasConfiguracoes(settings: unknown): boolean {
  const m = (settings as { iavek?: { manipulacao?: { bloquear_no_alto?: unknown } } } | null)?.iavek?.manipulacao;
  return m?.bloquear_no_alto === true;
}

export async function bloqueioDeManipulacaoLigado(pool: Pick<pg.Pool, 'query'>, tenantId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ settings: unknown }>('select settings from organizations where id = $1', [tenantId]);
    return bloqueioLigadoNasConfiguracoes(rows[0]?.settings);
  } catch {
    return false;
  }
}
