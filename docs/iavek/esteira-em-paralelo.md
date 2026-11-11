# Esteira em paralelo por organização (desenho, P2; nada implementado)

Pedido do Maestro (202351, 2a), como preparação para vender. Lê junto com `capacidade-50-clientes.md`.

## Hoje (medido em 11/11)

- `app/api/v1/cron/esteira-vendas/route.ts` roda as organizações **uma de cada vez** (`for … await`).
  - Cada uma fica dentro de `comTravaDaEsteira` (o `pg_try_advisory_xact_lock` por organização, v1.9.43).
  - O teto é o `maxDuration = 300` s da rota, e o scheduler também corta em 300 s.
- **A rodada da Fenômenos (1.520 leads) leva ~19 s.** O scheduler chama às :X0:00 / :X5:00, e a resposta vem às
  :X0:18 a :X0:20, nas 3 rodadas das 20:15 às 20:25Z.
- Em fila, cabem **~15 organizações do tamanho da Fenômenos** em 300 s. Na 16ª, a rota é cortada no meio, e as do
  fim da lista nunca rodam (a ordem é sempre a mesma).
- **A trava pega a conexão do pool das REQUISIÇÕES** (`getRequestPool()`, `DB_POOL_MAX=4`) e a segura pela rodada
  inteira (~19 s). O trabalho em si vai pelo cliente admin do Supabase (REST), não por esse pool.

## O desenho

1. **Um pool só das travas**, como o `poolDasTravas` da prospecção (`lib/prospecting/store.ts`).
   - Tamanho = a concorrência, separado do pool das requisições.
   - Rodar N em paralelo com a trava no pool de 4 deixaria as telas sem conexão.
2. **N organizações ao mesmo tempo.** Um laço com fila e N trabalhadores, sem biblioteca nova. Cada trabalhador
   pega a próxima organização, abre a trava dela no pool das travas e roda `rodarEsteira` + `rodarCompraFutura`.
   - A trava continua por organização: a mesma organização nunca roda duas vezes junto.
   - Organizações diferentes rodam lado a lado.
3. **Orçamento de tempo:**
   - nenhuma organização NOVA começa depois de 240 s;
   - a que ficou de fora vai no resultado como `pulada: "sem_tempo"`;
   - um aviso (amarelo) entra na saúde do servidor.
4. **Justiça:** a ordem passa a ser "a que rodou há mais tempo, primeiro" (o `esteiraRodou` já grava quando
   rodou). Quem ficou de fora numa rodada vai na frente na seguinte, e nenhuma loja fica para sempre no fim da fila.
5. **Os erros continuam isolados** por organização (o `try/catch` de hoje, com `esteiraFalhou`).

## O tamanho

| Concorrência N | Cabem por rodada de 5 min (orgs do tamanho da Fenômenos, ~19 s cada; até 240 s) | Conexões a mais no Postgres |
|---|---|---|
| 1 (hoje) | ~12 a 15 | 0 (usa o pool das requisições) |
| 2 | ~25 | 2 |
| **4 (recomendado)** | **~50** | **4** |
| 6 | ~75 | 6 |

**Recomendo N = 4:** cobre os 50 clientes do estudo com o orçamento de 240 s.

**Riscos e o que medir antes de ligar** (no canário, com o banco de TESTE carregado com várias lojas):

- **Memória do app:** 4 rodadas ao mesmo tempo dentro do processo do app (heap 576 hoje). É preciso medir o pico de
  uma rodada.
  - Se 4 × o pico chegar perto do amarelo da vigia (700 MB), a esteira sai do app para o **worker** (contêiner e
    memória próprios), ou N cai para 2.
  - No servidor novo (KVM 4, app com 3 GB), a folga é outra.
- **Carga no Supabase:** 4× as chamadas REST no pico da rodada. Conferir o limite de conexões e de requisições do
  plano.
- **N como configuração:** `ESTEIRA_CONCORRENCIA` (padrão 1, o comportamento de hoje), para ligar aos poucos: 1 → 2 → 4.

## Testes que a mudança precisa

- 2 organizações com a trava já pega: as outras rodam, e a travada sai como `pulada: "rodada_em_curso"`.
- N = 4 com 10 organizações: no máximo 4 rodando ao mesmo tempo (contador no dublê).
- Orçamento: com o relógio dublê, depois de 240 s nenhuma começa, e as que sobraram saem `sem_tempo`.
- Justiça: a ordem segue `esteira_rodou_em` crescente.
- O pool das travas é separado do pool das requisições (o mesmo teste da prospecção).
