# Saúde do servidor (ia.vek, desde 11/11/2026)

Pedido do Rodrigo depois do incidente de 11/11 (o heap do app estourou às 19:05Z): "para de fato nada travar
… rodar liso e com folga … e uma rotina para ficar nessa limpeza". Os scripts ficam no repo de operação
(`iavek-operacao`, pasta `saude/`). Liga e desliga com `bash saude/instalar.sh --ligar | --desligar | --conferir`.

## As 3 rotinas

| Rotina | Onde roda | Quando | O que faz |
|---|---|---|---|
| `medir.sh` (a vigia) | servidor do CRM | a cada 5 min | mede e grava `/root/iavek-saude/estado.json` + 1 linha em `/var/log/iavek-saude.log`; a única ação automática |
| `avisar.sh` (o aviso) | VPS dos agentes | a cada 5 min (1 min depois) | lê o estado por SSH e avisa o Maestro (e, no vermelho, o Rodrigo por áudio) |
| `limpar.sh` (a limpeza) | servidor do CRM | domingo 4h (Brasília) | imagens velhas, cache de build, journald, cópias velhas, /tmp; 1 linha em `/var/log/iavek-saude-limpeza.log` |

A vigia mora no servidor (e não na VPS) para que a ação da noite funcione mesmo se a VPS dos agentes cair.
O aviso mora na VPS porque é lá que estão o mensageiro e a voz.

## O que a vigia mede (só de fora)

Nada roda dentro dos contêineres. A memória de cada contêiner vem do cgroup (`memory.stat`, campo `anon`:
o que o processo usa de fato; o cache de disco o kernel devolve sozinho). O heap do Node não dá para ler de
fora sem entrar no contêiner, então o `anon` do app é o termômetro.

- app, waha, worker: `anon` × o teto (`mem_limit`);
- RAM disponível (`MemAvailable`), swap, disco `/`;
- todos os contêineres: rodando, healthy (quem tem healthcheck), reinício novo (`RestartCount` subiu com o
  mesmo contêiner), morto por falta de memória (`OOMKilled`);
- o WhatsApp: as sessões do WAHA em WORKING (pela API dele; a chave fica no `.env` do servidor e nunca é impressa).

## O semáforo

Provisório, até a Lupa trazer os limites do plano de contingência:

| | Amarelo | Vermelho |
|---|---|---|
| memória do contêiner (app, waha, worker) | ≥ 75% do teto | ≥ 90% do teto |
| RAM disponível | < 500 MB | < 250 MB |
| swap | > 500 MB | > 1000 MB |
| disco | > 80% | > 90% |
| contêiner parado, unhealthy, reiniciou sozinho, OOM | | sempre |
| sessão do WhatsApp fora de WORKING | | sempre |
| não leu as sessões do WhatsApp | sempre | |

- **Amarelo:** registro + mensagem ao Maestro, no máximo 1 a cada 30 min (na hora, se o problema mudar).
- **Vermelho:** o mesmo + 1 áudio curto no Telegram do Rodrigo (`falar.sh`), com o que está alto e o que o
  time está fazendo; também no máximo 1 a cada 30 min, salvo problema novo.
- **Voltou ao verde** depois de um aviso: 1 mensagem ao Maestro.
- **Vigia cega:** 3 leituras seguidas sem SSH, ou o estado do servidor com mais de 15 min → mensagem ao Maestro.
- A PAUSA das rotinas (`~/operacao/virada/PAUSA`) cala o aviso.

## A única ação automática

O **app** em vermelho de memória (≥ 90% do teto) por **3 leituras seguidas** (15 min), **só entre 21h e 7h de
Brasília**, e **no máximo 1 vez a cada 6 h** → `docker restart` SÓ do app (~14 s fora), registra e avisa.
De dia, só avisa. **O WAHA nunca é reiniciado por aqui** (cair o WhatsApp é pior que o app): sempre só avisa.

## A limpeza semanal

Domingo 4h, depois do backup do banco (3h) e do envio para fora (3h30). Nunca toca banco, volumes, sessões
do WhatsApp nem o `.env`.

1. **Imagens do ia.vek** (app, worker, scheduler). Ficam sempre:
   - a que está em uso;
   - as anotadas pela troca como "anterior" (`/root/iavek-imagem-anterior.txt`, para onde a volta vai);
   - a mais nova mais velha que a em uso;
   - as 2 mais novas do serviço.

   O resto sai. De outras imagens (waha, caddy, redis), só as soltas. Também o cache de build.
2. **journald:** vacuum até 200M. O limite fixo está em `/etc/systemd/journald.conf.d/iavek-limite.conf`:
   200M em disco e 50M em RAM.
3. **Cópias velhas:** `/root/iavek-backups/*` e `/root/iavek-*.csv.gz` com mais de 30 dias. Os backups diários
   do banco têm a retenção própria de 14, no `backup.sh`, e não passam por aqui.
4. **`/tmp`:** arquivos com mais de 7 dias.

Os logs dos contêineres giram sozinhos: `logging: *default-logging` (10 MB × 3) em todos, no
`docker-compose.prod.yml`. O worker era o único sem, e foi corrigido em 11/11. Vale a partir da próxima
recriação dele, na troca.

## A conferência dos limites em toda troca

O `trocar-producao.sh` confere, depois do `up`, os 4 valores do incidente (app 1024m e heap 576; waha 1280m e
heap 900) e avisa se mudarem. Ver `divergencias-do-upstream.md`.

## Os dados do banco (proposta de retenção, MEDIDA em 11/11; a decisão é do Rodrigo)

A vigia e a limpeza NÃO apagam nada do banco. O banco tem 1.152 MB. O crescimento desta semana NÃO é o
normal: entre 05/11 e 11/11 a esteira cobrou a mesma ligação em laço (`esteira_ligacao_cobrada`).

- **Por dia:** de 27 mil a 130 mil por dia, contra menos de 300 antes.
- **O fim:** parou na madrugada de 11/11 (4.717 às 00h, 5.403 às 01h, 742 às 02h).
- **Desde as 13h:** de 2 a 25 por hora, o normal.

Quase tudo o que pesa é a sobra dessa tempestade:

| Tabela | Tamanho | Linhas | O que é | Proposta |
|---|---|---|---|---|
| `crm_lead_activities` | 312 MB | 419.824 | 409.403 são `esteira_ligacao_cobrada` (a tempestade) | apagar só as cobranças repetidas (ficar com 1 por lead por dia); é o histórico do lead, então só com o ok |
| `event_log` | 357 MB | 492.883 | 408.974 são `central.aviso_criado`; 99,8% `done` | apagar `done` com mais de 14 dias (os `dead`, 30 dias). No ritmo normal, ~5 mil por dia |
| `agent_inbox_items` | 196 MB | 409.807 | 373.232 resolvidos (os avisos repetidos limpos em 11/11) | apagar os resolvidos com mais de 30 dias; nunca os abertos |
| `webhook_events_log` | 144 MB | 129.157 | já tem retenção: corpo 3 dias, linha 30 dias | nada |
| `api_audit_log` | 32 MB | 45.092 | auditoria, ~1,3 mil por dia | 180 dias ou 1 ano (auditoria e LGPD): decisão |
| `notificacoes` | pequeno | 834 | os avisos do sino | 90 dias |
| `llm_calls` | 1 MB | 2.162 | custo da IA | 180 dias (pequeno; não pesa) |

Apagar linhas não encolhe o arquivo na hora. O `autovacuum` reaproveita o espaço. O `VACUUM FULL` trava a
tabela: não usar em horário de uso.
