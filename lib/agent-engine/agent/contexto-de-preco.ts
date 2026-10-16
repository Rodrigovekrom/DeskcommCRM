import type pg from 'pg';
import {
  contarPerguntasDePreco,
  decidirAutorizacao,
  ehPerguntaDePreco,
  type ContextoDePreco,
  type MensagemParaContagem,
} from './preco-em-tres-niveis';

/**
 * Lê o contexto de preço de UMA conversa (D1, regra dos três níveis — ver
 * `preco-em-tres-niveis.ts`). Sem tabela nova: a contagem sai do histórico de
 * `messages` e o carro em discussão do `metadata.produto_codigo` que o envio com
 * fotos grava. Recalculado a cada turno, então não há estado que possa divergir.
 *
 * Janela: as últimas 300 mensagens. Uma troca de carro mais antiga que isso não
 * muda a conta de hoje (a contagem recomeça do carro mais recente da janela).
 */
const JANELA_DE_MENSAGENS = 300;

export async function lerContextoDePreco(
  pool: Pick<pg.Pool, 'query'>,
  ids: { tenantId: string; conversationId: string },
): Promise<ContextoDePreco> {
  const { rows } = await pool.query<{
    direction: string;
    texto: string | null;
    produto_codigo: string | null;
  }>(
    `select direction, coalesce(body, media_derived_text) as texto,
            metadata->>'produto_codigo' as produto_codigo
       from (select direction, body, media_derived_text, metadata, created_at, id
               from messages
              where organization_id = $1 and conversation_id = $2
              order by created_at desc, id desc
              limit ${JANELA_DE_MENSAGENS}) ultimas
      order by created_at asc, id asc`,
    [ids.tenantId, ids.conversationId],
  );
  const mensagens: MensagemParaContagem[] = rows.map((r) => ({
    direcao: r.direction === 'outbound' ? 'outbound' : 'inbound',
    texto: r.texto,
    produtoCodigo: r.produto_codigo,
  }));
  const { perguntas, produtoCodigo } = contarPerguntasDePreco(mensagens);
  return completarComCatalogo(pool, ids.tenantId, { perguntas, produtoCodigo });
}

/**
 * O caminho do TESTE (aba Testar do agente): não há conversa real, então quem
 * testa declara o cenário — quantas vezes o cliente já pediu o preço antes e
 * qual carro está em discussão — e a mensagem de teste soma 1 se pedir preço.
 */
export async function contextoDePrecoDaSimulacao(
  pool: Pick<pg.Pool, 'query'>,
  tenantId: string,
  simulacao: { perguntasAnteriores: number; produtoCodigo: string | null },
  mensagemDeTeste: string | null,
): Promise<ContextoDePreco> {
  const perguntas =
    Math.max(0, Math.floor(simulacao.perguntasAnteriores)) + (ehPerguntaDePreco(mensagemDeTeste) ? 1 : 0);
  const produtoCodigo = simulacao.produtoCodigo?.trim() || null;
  return completarComCatalogo(pool, tenantId, { perguntas, produtoCodigo });
}

async function completarComCatalogo(
  pool: Pick<pg.Pool, 'query'>,
  tenantId: string,
  parcial: { perguntas: number; produtoCodigo: string | null },
): Promise<ContextoDePreco> {
  let precoDoCatalogo: number | null = null;
  if (parcial.produtoCodigo !== null && parcial.perguntas >= 3) {
    const { rows } = await pool.query<{ preco_cents: string | number }>(
      `select preco_cents from catalog_products
        where organization_id = $1 and codigo = $2 and ativo
        limit 1`,
      [tenantId, parcial.produtoCodigo],
    );
    const bruto = rows[0]?.preco_cents;
    precoDoCatalogo = bruto === undefined ? null : Number(bruto);
  }
  return { ...parcial, autorizadoCents: decidirAutorizacao(parcial.perguntas, precoDoCatalogo) };
}
