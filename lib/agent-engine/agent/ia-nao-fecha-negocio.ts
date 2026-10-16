import type pg from 'pg';

/**
 * A IA NUNCA FECHA NEGÓCIO (ia.vek, decisão do Rodrigo em 15/10/2026).
 *
 * A ferramenta nativa `update_lead_state` aceita `won` e `lost`, e o motor espelha
 * o estado no card do CRM: um "ganho" dito pelo modelo vira negócio ganho. Na
 * revenda, quem fecha (ou dá como perdido) é a equipe — a IA conduz até o
 * compromisso e passa. O prompt já proíbe; esta é a trava do SISTEMA, para a
 * regra não depender de o modelo obedecer.
 *
 * Liga-se por organização: `organizations.settings.ia.pode_fechar_negocio === true`
 * devolve o comportamento antigo. Ausente (o padrão desta instalação) = recusa.
 */
export const ESTADOS_DE_FECHAMENTO = new Set(['won', 'lost']);

export function recusaDeFechamento(
  estadoPedido: unknown,
  organizacaoPermite: boolean,
): { ok: false; error: { code: string; message: string } } | null {
  if (organizacaoPermite) return null;
  if (typeof estadoPedido !== 'string' || !ESTADOS_DE_FECHAMENTO.has(estadoPedido)) return null;
  return {
    ok: false,
    error: {
      code: 'fechamento_e_da_equipe',
      message:
        'Você não marca negócio como ganho nem como perdido: isso é da equipe. ' +
        'Registre o que aconteceu numa nota curta e, se for o caso, passe o atendimento para a equipe (handoff).',
    },
  };
}

/** Lê o interruptor da organização. Falha de leitura = mais estrito (não permite). */
export async function organizacaoDeixaIaFecharNegocio(
  pool: Pick<pg.Pool, 'query'>,
  tenantId: string,
): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ pode: string | null }>(
      `select settings->'ia'->>'pode_fechar_negocio' as pode from organizations where id = $1`,
      [tenantId],
    );
    return rows[0]?.pode === 'true';
  } catch {
    return false;
  }
}
