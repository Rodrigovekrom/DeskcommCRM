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
 *
 * ia.vek v1.9.45 (Maestro 203253): a conexão da trava vem de um pool SÓ DAS TRAVAS (`poolDasTravasDaEsteira`), e não
 * do pool das requisições. MEDIDO em 11/11: a trava segurava 1 das 4 conexões das TELAS (DB_POOL_MAX=4) por ~19 s a
 * cada rodada de 5 min — lentidão possível nas telas, hoje. O pool das travas tem 1 conexão (as organizações ainda
 * rodam em fila; o paralelo é outra versão) e se identifica no Postgres como `iavek-trava-esteira`.
 */
import pg from "pg";

export const chaveDaTravaDaEsteira = (orgId: string) => `esteira:${orgId}`;

export type ResultadoDaTrava<T> = { rodou: true; valor: T } | { rodou: false };

export async function comTravaDaEsteira<T>(
  pool: Pick<pg.Pool, "connect">,
  orgId: string,
  fn: () => Promise<T>,
): Promise<ResultadoDaTrava<T>> {
  // ia.vek v1.9.46 (nota 1 da Lupa, Maestro 234646): o pool tem 1 conexão. Se uma rodada presa (no MESMO processo)
  // ainda segura a conexão, esperar por ela faria esta rodar DOBRADA logo depois. Passou do tempo de esperar a
  // conexão (TEMPO_PARA_PEGAR_A_CONEXAO_MS, bem abaixo dos 5 min da rodada): pula, como "rodada_em_curso".
  let db: pg.PoolClient;
  try {
    db = (await pool.connect()) as pg.PoolClient;
  } catch (e) {
    if (eTempoEsgotadoDaConexao(e)) return { rodou: false };
    throw e;
  }
  let aberta = false;
  try {
    await db.query("begin");
    aberta = true;
    // ia.vek v1.9.46 (nota 1 da Lupa): os tetos valem só nesta transação (o pooler devolve a conexão limpa).
    await db.query(
      `set local statement_timeout = ${TETO_DOS_COMANDOS_DA_TRAVA_MS}; set local lock_timeout = ${TETO_DOS_COMANDOS_DA_TRAVA_MS}`,
    );
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

/** Quanto a rodada espera a conexão da trava antes de pular (bem abaixo do intervalo de 5 min da rodada). */
export const TEMPO_PARA_PEGAR_A_CONEXAO_MS = 5_000;
/** O teto de cada comando na conexão da trava (o begin, o try_lock e o rollback são instantâneos). */
export const TETO_DOS_COMANDOS_DA_TRAVA_MS = 10_000;

/** O erro do node-postgres quando o pool não entrega a conexão a tempo. */
export function eTempoEsgotadoDaConexao(e: unknown): boolean {
  return e instanceof Error && /timeout exceeded when trying to connect/i.test(e.message);
}

/** Quantas conexões o pool das travas tem. 1 enquanto a esteira roda as organizações em fila. */
export const CONEXOES_DAS_TRAVAS_DA_ESTEIRA = 1;
export const NOME_DA_CONEXAO_DA_TRAVA = "iavek-trava-esteira";
const POOLS_DAS_TRAVAS = new WeakMap<object, pg.Pool>();

/**
 * O pool SÓ DAS TRAVAS da esteira, montado a partir do pool das requisições (a mesma URL), uma vez por processo.
 * Separado, a trava nunca tira uma conexão das telas. Dublês de teste e pools sem URL: o próprio pool.
 */
export function poolDasTravasDaEsteira(base: Pick<pg.Pool, "connect">): Pick<pg.Pool, "connect"> {
  const url = (base as { options?: { connectionString?: string } }).options?.connectionString;
  if (!url) return base;
  let p = POOLS_DAS_TRAVAS.get(base);
  if (!p) {
    p = new pg.Pool({
      connectionString: url,
      max: CONEXOES_DAS_TRAVAS_DA_ESTEIRA,
      application_name: NOME_DA_CONEXAO_DA_TRAVA,
      // ia.vek v1.9.46 (nota 1 da Lupa): nunca esperar sem fim pela conexão. Os tetos de comando e de trava vão
      // por `set local` na transação (comTravaDaEsteira), não como parâmetro de partida (o pooler pode recusar).
      connectionTimeoutMillis: TEMPO_PARA_PEGAR_A_CONEXAO_MS,
    });
    p.on("connect", (c) => c.on("error", () => undefined));
    p.on("error", () => undefined);
    POOLS_DAS_TRAVAS.set(base, p);
  }
  return p;
}
