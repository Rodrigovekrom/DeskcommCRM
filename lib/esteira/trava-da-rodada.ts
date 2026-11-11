/**
 * ia.vek v1.9.43 (P3, 11/11): UMA rodada da esteira por organização de cada vez.
 *
 * O defeito: o cron chama a rodada a cada 5 min, e uma rodada lenta (ou um disparo à mão no meio)
 * se sobrepunha à seguinte. As duas liam o mesmo estado ("este par ainda não foi cobrado", "este
 * lead ainda não tem ligação") e as duas escreviam: cobrança e tarefa de ligação em dobro. Na
 * produção foram 0 casos medidos, mas no TESTE a corrida criou 10 tarefas L4 repetidas.
 *
 * A trava: `pg_try_advisory_xact_lock`, numa TRANSAÇÃO aberta numa conexão própria do pool, com a
 * chave `esteira:<org>`. Ela é TRY: quem chega com a rodada anterior ainda em curso NÃO espera, PULA
 * aquela organização (a próxima rodada do cron faz o trabalho).
 *
 * Por que de TRANSAÇÃO e não de sessão: na produção o SUPABASE_DB_URL é o pooler em modo
 * TRANSAÇÃO (porta 6543). Fora de uma transação, cada comando pode cair num backend diferente: um
 * `pg_try_advisory_lock` de sessão travaria num backend e o `pg_advisory_unlock` iria para outro,
 * a trava ficaria presa e a esteira pularia a organização PARA SEMPRE. Dentro de `begin`…`commit`
 * o pooler prende um backend só, e a trava sai sozinha no commit, no rollback ou se a conexão cair
 * (o processo morreu: o Postgres aborta a transação). A transação não escreve nada; a rodada em si
 * continua pelo cliente do Supabase, como antes.
 *
 * É no Postgres, não na memória: o app pode ter mais de um processo (app + canário, ou réplicas).
 * A chave é por organização: a rodada de uma organização não segura a de outra.
 */
import type pg from "pg";

export const chaveDaTravaDaEsteira = (orgId: string) => `esteira:${orgId}`;

export type ResultadoDaTrava<T> = { rodou: true; valor: T } | { rodou: false };

export async function comTravaDaEsteira<T>(
  pool: Pick<pg.Pool, "connect">,
  orgId: string,
  fn: () => Promise<T>,
): Promise<ResultadoDaTrava<T>> {
  const db = await pool.connect();
  let aberta = false;
  try {
    await db.query("begin");
    aberta = true;
    const r = await db.query<{ travou: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as travou",
      [chaveDaTravaDaEsteira(orgId)],
    );
    if (r.rows[0]?.travou !== true) return { rodou: false };
    return { rodou: true, valor: await fn() };
  } finally {
    try {
      // Commit OU rollback soltam a trava: a transação não escreveu nada.
      if (aberta) await db.query("rollback");
    } finally {
      db.release();
    }
  }
}
