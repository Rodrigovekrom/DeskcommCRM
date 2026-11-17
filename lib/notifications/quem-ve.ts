/**
 * ia.vek CRM-530: o aviso no celular vai SÓ a quem pode VER aquilo de que ele fala.
 *
 * O defeito (59.2): a mensagem nova, a do grupo e o aviso da Central iam por `enviarPushDaOrg`, ou seja, a TODAS as
 * inscrições da org, sem conferir quem vê a conversa nem se a pessoa ainda é membro. Com o nome, o texto e a foto do
 * contato na tela de bloqueio do celular de qualquer um da loja.
 *
 * O desenho: NÃO copiar a regra da RLS. A `conversations_select` depende de quatro funções que decidem por `auth.uid()`
 * (a visão por papel, os contatos que a guardiã guarda, os escondidos da SDR pela 0641, os do Follow-up), e qualquer
 * cópia divergiria na primeira mudança. Em vez disso, o servidor PERGUNTA À PRÓPRIA POLICY, inscrito por inscrito: abre
 * uma transação, assume o papel `authenticated` com o `sub` da pessoa (o mesmo caminho do PostgREST e dos testes de
 * banco), pergunta se a linha aparece e desfaz. O que a tela mostraria a ela é exatamente o que decide o aviso.
 *
 * Candidatos: só quem tem inscrição de push na org E é membro ATIVO (`revoked_at` nulo e `accepted_at` preenchido).
 * Quem saiu da loja não recebe, mesmo com a inscrição antiga no aparelho.
 *
 * Custo: uma consulta pequena por candidato (os inscritos da org, poucos), numa transação que não escreve nada.
 * Nunca lança: em erro, devolve a lista vazia (ninguém recebe) e o chamador registra. Errar para o lado do silêncio é
 * o lado seguro: o aviso não sai, a mensagem segue na inbox.
 */
import type pg from 'pg';

import { REFERENCIAS_DE_AVISO } from '@/lib/ai/inbox-destino';

/**
 * As tabelas cuja visibilidade decide o aviso: a conversa (mensagem nova e grupo) e as que a Central referencia
 * (`REFERENCIAS_DE_AVISO`, a MESMA lista que a Central usa para abrir o aviso). Lista FECHADA: o nome da tabela entra no
 * SQL e nunca vem de fora.
 */
export const TABELAS_QUE_DECIDEM: ReadonlySet<string> = new Set<string>([
  'conversations',
  ...Object.values(REFERENCIAS_DE_AVISO).map((r) => r.tabela),
]);

/**
 * Os textos SQL, exportados para o teste de BANCO rodar EXATAMENTE a mesma sequência contra a policy de verdade
 * (tests/invariants/iavek-crm530-push-quem-ve.test.ts).
 */
export const SQL_CANDIDATOS = `select distinct ps.user_id
       from public.push_subscriptions ps
       join public.user_organizations uo
         on uo.organization_id = ps.organization_id and uo.user_id = ps.user_id
      where ps.organization_id = $1
        and uo.revoked_at is null
        and uo.accepted_at is not null`;
export const SQL_ASSUMIR_PAPEL = 'set local role authenticated';
export const SQL_CLAIMS = `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`;
export const claimsDe = (userId: string) => JSON.stringify({ sub: userId, role: 'authenticated' });
export const sqlVe = (tabela: string) => `select exists (select 1 from public.${tabela} where id = $1) as ve`;

/** Os inscritos ATIVOS da org (com inscrição de push e membro aceito, não revogado). */
export async function inscritosAtivos(pool: pg.Pool, orgId: string): Promise<string[]> {
  const { rows } = await pool.query<{ user_id: string }>(SQL_CANDIDATOS, [orgId]);
  return rows.map((r) => r.user_id);
}

/** O prazo de cada transação de visibilidade (Lupa 183222): curto, para nunca segurar conexão do pool. */
export const SQL_PRAZO = "set local statement_timeout = '2s'";

/**
 * Quem, entre os inscritos ativos, VÊ a linha `id` da `tabela` pela RLS.
 *
 * UMA transação POR MENSAGEM (Lupa 183222; MEDIDO 17/11: até 21 mensagens/min na Fenômenos e DB_POOL_MAX=4): `begin`;
 * `statement_timeout` de 2 s; `set local role authenticated`; e, para CADA candidato, as claims dele (`set_config` local)
 * e o `select exists`; no fim, `rollback` e `release`, SEMPRE (finally).
 * Qualquer erro, ou o prazo estourado, FECHA: devolve a lista vazia (ninguém recebe) e grava no log. Nunca cai na org
 * inteira.
 */
export async function inscritosQueVeem(
  pool: pg.Pool,
  orgId: string,
  tabela: string,
  id: string,
  log: (msg: string, meta: Record<string, unknown>) => void = () => undefined,
): Promise<string[]> {
  if (!TABELAS_QUE_DECIDEM.has(tabela) || !/^[a-z_]+$/.test(tabela)) return [];
  let candidatos: string[];
  try {
    candidatos = await inscritosAtivos(pool, orgId);
  } catch (err) {
    log('push_quem_ve_candidatos_falhou', { erro: err instanceof Error ? err.message.slice(0, 200) : 'desconhecido' });
    return [];
  }
  if (candidatos.length === 0) return [];
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    log('push_quem_ve_sem_conexao', { erro: err instanceof Error ? err.message.slice(0, 200) : 'desconhecido' });
    return [];
  }
  const veem: string[] = [];
  try {
    await client.query('begin');
    await client.query(SQL_PRAZO);
    await client.query(SQL_ASSUMIR_PAPEL);
    for (const userId of candidatos) {
      await client.query(SQL_CLAIMS, [claimsDe(userId), userId]);
      // a RLS da tabela decide; a org já foi filtrada nos candidatos
      const { rows } = await client.query<{ ve: boolean }>(sqlVe(tabela), [id]);
      if (rows[0]?.ve === true) veem.push(userId);
    }
  } catch (err) {
    // FECHA: um erro no meio (ou o prazo) não manda a ninguém, nem aos que já tinham respondido "vê"
    log('push_quem_ve_falhou', { tabela, candidatos: candidatos.length, erro: err instanceof Error ? err.message.slice(0, 200) : 'desconhecido' });
    veem.length = 0;
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
  return veem;
}

/**
 * A gerência ATIVA inscrita (admin e manager): o destino dos avisos da Central SEM referência (ex.: a IA sem saldo, que
 * não carrega dado de cliente e é da loja inteira).
 */
export const SQL_GERENCIA = `select distinct ps.user_id
         from public.push_subscriptions ps
         join public.user_organizations uo
           on uo.organization_id = ps.organization_id and uo.user_id = ps.user_id
        where ps.organization_id = $1
          and uo.revoked_at is null
          and uo.accepted_at is not null
          and uo.role in ('admin', 'manager')`;

export async function gerenciaInscrita(pool: pg.Pool, orgId: string): Promise<string[]> {
  try {
    const { rows } = await pool.query<{ user_id: string }>(SQL_GERENCIA, [orgId]);
    return rows.map((r) => r.user_id);
  } catch {
    return [];
  }
}
