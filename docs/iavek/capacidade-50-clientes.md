# Estudo de capacidade: de 2 para 50 clientes

Pedido do Rodrigo (11/11/2026). Escrito pela Lupa, só com leitura. Os números de hoje vêm da produção em 11/11, por volta das 20h UTC. **MEDIDO** é o que foi medido; **SUPOSTO** é estimado, sempre com a conta.

A média por dia usa os últimos 14 dias. Ela deixa de fora o lixo do laço de 05 a 11/11: as atividades `esteira_ligacao_cobrada`, os eventos `central.aviso_criado` e os avisos "🚨 Ligação atrasada" desse período.

## 1. Banco (Supabase), por organização (MEDIDO)

Tamanho total do banco: **1.152 MB**. Desses, uns **800 MB são o lixo do laço**: 408 mil linhas em cada uma das 3 tabelas (crm_lead_activities, event_log e agent_inbox_items). **Sem o lixo, o banco tem uns 350 MB** (SUPOSTO: 1.152 menos a parte do laço, já com os índices).

Dados por dia, só as linhas (o índice soma +80% a +100%):

| Tabela | Fenômenos: linhas/dia | Fenômenos: KB/dia | AP Clinic: linhas/dia | AP Clinic: KB/dia |
|---|---|---|---|---|
| crm_leads | 64 | 313 | 2,3 | 0,5 |
| contacts | 38 | 161 | 2,1 | 0,8 |
| conversations | 38 | 15 | 2,1 | 0,8 |
| messages | 1.128 | 460 | 93 | 35 |
| crm_lead_activities | 611 | 187 | 21 | 6 |
| event_log | 2.978 | 1.802 | 175 | 121 |
| agent_inbox_items (Central) | 83 | 25 | 0,1 | 0 |
| api_audit_log | 1.554 | 461 | 93 | 26 |
| webhook_events_log (com retenção: o corpo fica 3 dias, a linha 30 dias) | 4.001 | 3.553 | 513 | 385 |

- **Fenômenos:** uns 3,4 MB por dia de dados que ficam (sem o webhook_events_log), ou **~7 MB por dia com os índices**, ~2,5 GB por ano (SUPOSTO: o event_log é 2/3 disso; se ele tiver retenção de 90 dias, a conta cai para ~1,2 GB por ano). O webhook_events_log se estabiliza em uns 60 MB por cliente, por causa da retenção.
- **AP Clinic:** uns 0,19 MB por dia, ou ~0,4 MB com os índices. **Uma clínica hoje é ~1/15 da Fenômenos no banco, e ~1/12 nas mensagens.** Ela começou agora, então SUPOSTO para um ano.

## 2. Storage (whatsapp-media e catálogo) (MEDIDO)

Total: **2,49 GB** (de 15/10 a 11/11). A retenção de mídia é de **365 dias** em todas as organizações: o storage cresce por 1 ano e depois se estabiliza.

| Organização | Total | Por dia (14 d) | De quê |
|---|---|---|---|
| Fenômenos | 1,64 GB (+75 MB de fotos do catálogo) | **61 MB/dia** | imagens 30, documentos 20, áudios 9, vídeos 2,4 MB/dia |
| AP Clinic | 140 MB | **9 MB/dia** | documentos 8, imagens 0,9, áudios 0,1 |
| ia.vek (interno) | 770 MB | 36 MB/dia | quase só documentos |

Em 12 meses: Fenômenos ~22 GB e uma clínica ~3,3 GB (SUPOSTO: o ritmo de hoje vezes 365).

## 3. WhatsApp (WAHA, NOWEB) (MEDIDO, salvo onde diz)

- 4 sessões: a Fenômenos tem 2 números, a AP Clinic 1 e a ia.vek 1.
- Mensagens por dia por número (14 d):
  - Fenômenos (final 8914): **1.127**, das quais 370 recebidas;
  - Fenômenos (final 3698): 0,5;
  - AP Clinic: 93;
  - ia.vek: 204.
- Pico de mensagens por hora: Fenômenos 366, ia.vek 130, AP Clinic 54.
- Memória: logo depois do reinício (19:52Z), **386 a 461 MiB para as 4 sessões**. Antes do reinício, depois de 34 dias, eram **1,97 GB** (1,11 na RAM + 0,85 no swap): ~45 MB por dia, com o heap sem teto.
- SUPOSTO: uns 150 MB de base mais 60 a 100 MB por sessão. A curva com o heap de 900 MB ainda está sendo medida (a vigia de saúde vai dar o número diário).
- SUPOSTO a conferir: a imagem é o WAHA Core (grátis). O próprio compose diz que o multi-número e o retry pago são do WAHA Plus. Hoje 4 sessões estão em WORKING no Core. Antes de crescer, confirme com o fornecedor o limite de sessões por instância e por licença.

## 4. App (a tela e a API)

- Usuários ativos ao mesmo tempo no pico: **5**, na janela de 15 min de 09/11 às 15h15 (Fenômenos), com 67 ações. MEDIDO por quem escreveu ou mandou mensagem; quem só olha a tela não aparece, então o número real é maior (SUPOSTO).
- Membros: 17 na Fenômenos, 1 na AP Clinic e 1 na ia.vek.
- Memória: 240 a 390 MiB no uso normal; pico de 728 MB antes da queda das 19:05 (ver o plano de contingência).
- CPU: o load average fica em 0,4 nos 2 vCPU (MEDIDO às 20:20Z). Na leitura instantânea, o app chega a picos de 88% de 1 vCPU.
- Requisições por minuto: NÃO DÁ para medir. O caddy só grava os erros, sem log de acesso. Para medir, seria preciso ligar o log de acesso do caddy.

## 5. Worker, scheduler e crons (MEDIDO)

- O scheduler tem 42 crons. A cada minuto rodam o routing-worker, o followup-flow-worker e o campaign-worker; a cada 15 min, o risk-watcher.
- **Esteira de vendas** (a cada 5 min, teto de 300 s): uma rodada com a Fenômenos (~900 leads abertos) leva **mediana de 19 s e máximo de 172 s** (55 rodadas nas últimas 6 h). Ela roda as organizações **UMA DEPOIS DA OUTRA** (um laço `for` na rota).
  - SUPOSTO linear: com 10 lojas, 190 s na mediana; com ~15 lojas, passa dos 300 s; com 50, ~16 min. A rodada seguinte seria PULADA pela trava, e a esteira atrasaria.
  - **É o 1º gargalo de software.**
- Risk-watcher (a cada 15 min, teto de 60 s): no canário, a 1ª passada com 857 estados levou 73 s; as seguintes, 2 s. Também é por organização. SUPOSTO: ele aperta junto com a esteira.
- Worker: 268 MiB parado o dia inteiro, de 512.

## 6. Supabase (MEDIDO no banco; o plano vem do registro no cofre)

- Plano: **Pro, máquina Small** (2 GB de RAM, max_connections 90), sa-east-1. PostgreSQL 17.
- Conexões agora: **~53 de 90** (PostgREST 23, supabase_admin 11, postgres 5, auth 4, e mais). O app e o worker usam o pooler 6543 com DB_POOL_MAX=4.
- Banco: 1,15 GB (0,35 GB sem o lixo). Storage: 2,49 GB.
- Egress: NÃO DÁ para medir daqui; precisa do painel do Supabase (o Rodrigo tem o acesso).
- SUPOSTO, do que o Pro costuma incluir (o Maestro confere os preços de hoje): 8 GB de disco de banco, 100 GB de storage e 250 GB de egress por mês, e o excedente pago por GB. As máquinas maiores (Medium 4 GB e Large 8 GB) sobem o max_connections.

## 7. Projeção: lojas do tamanho da Fenômenos

Tudo aqui é SUPOSTO: o ritmo de hoje, linear. Uma clínica do tamanho da AP Clinic é ~1/12 de uma loja (pense em 12 clínicas por loja).

| | Hoje (2 clientes) | 10 lojas | 25 lojas | 50 lojas |
|---|---|---|---|---|
| Mensagens/dia | ~1.400 | ~11.000 | ~28.000 | ~56.000 |
| Sessões do WhatsApp | 4 | ~13 a 20 | ~30 a 50 | ~60 a 100 |
| WAHA (RAM) | 0,4 a 0,5 GB | ~1,5 a 2,2 GB | ~3 a 5 GB (2 instâncias) | ~6 a 10 GB (3 a 4 instâncias) |
| App + worker (RAM) | 0,6 GB | ~1,5 GB (app com 1,5 GB) | ~3 GB (2 apps) | ~5 GB (3 a 4 apps) |
| **VPS (RAM / vCPU)** | 3,9 GB / 2 | **8 GB / 4** | **16 GB / 8** | **32 GB / 8 a 16**, ou 2 VPS (uma só para o WAHA) |
| Banco em 12 meses | 0,35 GB | ~12 a 25 GB | ~30 a 63 GB | ~60 a 125 GB |
| Storage em 12 meses | 2,5 GB | ~220 GB | ~550 GB | ~1,1 TB |
| Conexões ao banco | 53/90 | ~70 a 90 | >90: Medium ou Large | Large ou maior, e um pooler revisado |
| **Plano do Supabase** | Pro + Small | Pro + **Medium**, com disco e storage extra | Pro + **Large** | Pro + **XL** (ou Team), e o storage talvez fora do Supabase (S3/B2) |
| Disco da VPS (98 GB) | 26% | ok | ok | ok (a mídia fica no Supabase, não na VPS) |
| **1º gargalo** | memória (o caso de hoje) | **a esteira, com ~15 lojas**: as rodadas passam de 300 s; também o tamanho do banco e do storage no Pro | WAHA (sessões numa instância) e conexões ao banco | storage (~1 TB), WAHA e CPU do app |

Os gargalos, na ordem em que aparecem:

1. **A esteira, uma organização depois da outra** (com ~15 lojas). Arrumar ANTES de passar de 10: rodar em paralelo, com um limite, ou um cron por organização.
2. **A RAM da VPS de 3,9 GB:** sem folga já com 3 a 4 lojas. Subir para 8 GB antes da 3ª loja.
3. **Storage e banco no Pro:** passam do incluso com ~5 lojas (banco) e ~5 lojas (storage de 100 GB). É custo, não queda.
4. **WAHA:** dezenas de sessões numa instância; confirmar a licença e dividir em instâncias.
5. **Conexões do Supabase:** subir de máquina quando passar de ~70 de 90.

O que medir antes de vender, para trocar SUPOSTO por MEDIDO:

- ligar o log de acesso do caddy (requisições por minuto);
- 7 dias da vigia de saúde (a curva do WAHA com o heap de 900 MB);
- o egress no painel do Supabase;
- a retenção do event_log (o maior crescimento do banco).
