# Plano de contingência de memória — servidor do CRM

Pedido do Rodrigo (11/11/2026). Escrito pela Lupa, só com leitura. Cada número diz se é **MEDIDO** (medido hoje) ou **SUPOSTO** (estimado, porque não dá para medir de fora).

## 0. Onde estamos (MEDIDO em 11/11)

| Peça | Teto do contêiner | Heap do Node | Uso normal hoje | O que aconteceu |
|---|---|---|---|---|
| App (a tela e a API) | 1.024 MiB (era 768) | 576 MB (era ~394, automático) | 240 a 390 MiB | Às 19:05Z caiu: "JavaScript heap out of memory" com o heap em ~394 MB e o contêiner com pico de 728 MB. Voltou em menos de 1 s (95 erros 502). |
| WAHA (o WhatsApp, 4 sessões) | 1.280 MiB | 900 MB (era 16.384) | 386 a 461 MiB depois do reinício das 19:52Z | Estava há 34 dias no ar com 1,11 GB na RAM **e mais 852 MB no swap**, e tinha batido no teto. As sessões voltaram a WORKING em ~10 s, e a 1ª mensagem chegou às 19:53Z. |
| Worker | 512 MiB | padrão | 268 MiB, parado o dia inteiro | — |
| Servidor | 3,9 GB de RAM, 2 vCPU, 2 GB de swap | — | RAM disponível 2.383 MB e swap 117 MB (às 20:15Z) | De manhã eram 1.498 MB disponíveis e 962 MB de swap, quase tudo do WAHA. |

Fora do docker (MEDIDO): o fail2ban usa 292 MiB, o journald 99 e o dockerd 69.

**A regra de ouro:** o Node morre ANTES de o contêiner encher. O app morre com uns **900 MB** (576 de heap + ~330 fora do heap, SUPOSTO a partir do pico de hoje). O WAHA morre com uns **1.050 a 1.150 MB**. Por isso os limites abaixo são em MB, não em "% do teto".

## 1. Semáforo

| Peça | Verde | Amarelo | Vermelho |
|---|---|---|---|
| App (memória do contêiner) | < 700 MB | 700 a 799 MB | >= 800 MB, ou reiniciou sozinho |
| WAHA (memória do contêiner) | < 900 MB | 900 a 1.049 MB | >= 1.050 MB, ou reiniciou sozinho |
| WAHA (swap do próprio contêiner) | < 100 MB | 100 a 299 MB | >= 300 MB |
| Worker | < 384 MB (75%) | 384 a 460 MB | > 460 MB (90%), ou reiniciou sozinho |
| Servidor: RAM disponível | > 500 MB | 250 a 500 MB | < 250 MB |
| Servidor: swap usado | < 500 MB | 500 a 1.000 MB | > 1.000 MB |
| Disco | < 80% | 80 a 90% | > 90% (hoje 26%: 25 GB de 98 GB) |
| WhatsApp | todas as sessões WORKING | — | alguma fora de WORKING |
| Contêiner | running e healthy | starting | parado, unhealthy, reinício novo ou morto por falta de memória (só quando MUDA) |

## 2. Alarmes automáticos

- **O que medir:** a memória (anon) e o swap de cada contêiner, o teto, os reinícios, o OOM (só a mudança), o healthy, a RAM disponível, o swap do servidor, o disco e as sessões do WAHA.
- **De quanto em quanto tempo:** a cada 5 min (medir.sh no servidor; avisar.sh na VPS, 1 min depois).
- **Quem é avisado:**
  - Amarelo: só o Maestro, 1 vez por CATEGORIA e no máximo 1 a cada 30 min.
  - Vermelho: o Maestro e um áudio no Telegram do Rodrigo. O áudio sai na 1ª vez de cada categoria, com lembrete no máximo a cada 3 h. De madrugada (23h às 7h), o áudio só sai para sistema fora do ar, WhatsApp caído ou reinício, não para porcentagem.
  - Voltou ao verde: 1 mensagem ao Maestro.
  - Vigia cega (3 leituras sem SSH, ou a leitura com mais de 15 min): o Maestro.
- **Textos:**
  - Amarelo, ao Maestro: "SAÚDE DO SERVIDOR: AMARELO. <o quê> (ex.: app com 720 MB; o limite amarelo é 700). Agora: app X, WAHA Y, worker Z, RAM disponível R, swap S. Nada foi feito."
  - Vermelho, áudio ao Rodrigo: "Alerta do servidor do CRM: <o quê, em palavras>. <O que foi feito: o app foi reiniciado sozinho em uns 14 segundos / por ser horário de uso, nada foi reiniciado>. O Maestro foi avisado."
- **Para o alarme valer:** a comparação de "mudou" tem de ser por CATEGORIA, sem os números no texto. Senão sai 1 aviso a cada 5 min (achado da revisão de 11/11).

## 3. Ações por cor

| Cor | Ação, em ordem | Quem decide | Tempo fora | Como voltar |
|---|---|---|---|---|
| Amarelo (qualquer peça) | 1. Olhar a tendência das últimas 6 leituras. 2. Se o app estiver subindo, marcar o reinício dele para a hora calma. 3. Nada mais. | O time sozinho | 0 | — |
| Vermelho no app, de NOITE (21h às 7h) | Reiniciar SÓ o app (`docker restart`), automático, depois de 3 leituras seguidas em vermelho, no máximo 1 vez a cada 6 h. | Automático (aprovado no plano) | ~14 s (MEDIDO hoje) | Nada a desfazer: a config fica igual. Depois, conferir as mensagens presas (item 4, passo 3). |
| Vermelho no app, de DIA | 1. Avisar. 2. Se ele chegar a 850 MB, reiniciar só o app, avisando a loja antes que a tela vai piscar uns 15 s. | O reinício de dia precisa do ok do Rodrigo, pelo Maestro | ~14 s | Igual ao de cima. |
| Vermelho no WAHA (memória ou swap) | 1. NUNCA automático. 2. Reiniciar o WAHA numa hora calma, com a loja avisada. | Ok do Rodrigo, pelo Maestro | ~10 a 30 s sem WhatsApp. Hoje as sessões voltaram em ~10 s; as mensagens que entram no meio chegam depois da reconexão. | Se uma sessão não voltar a WORKING em 2 min, reiniciar só essa sessão pela API do WAHA. Se pedir QR, chamar a loja. |
| Vermelho no worker | Reiniciar só o worker (as filas esperam e retomam). | O time sozinho, de noite; de dia, avisar o Maestro antes | ~10 s; nada se perde, a fila fica no banco | Nada a desfazer. |
| Vermelho no servidor (RAM < 250 MB ou swap > 1.000 MB) | 1. Ver quem está crescendo. 2. Reiniciar quem estiver acima do próprio amarelo, na ordem worker, app, WAHA. 3. Se ninguém estiver: o fail2ban (292 MiB) e o journald. | Os passos 1 e 3, o time; os reinícios seguem as regras acima | Igual ao de cada peça | — |
| Aumentar um teto ou o heap | Editar o docker-compose.prod.yml do servidor (backup antes), e só ele. | Ok do Rodrigo, pelo Maestro | Reinício da peça (~14 s no app, ~10 a 30 s no WAHA) | O backup em /root/iavek-backups/memoria-*. O patch em /root/iavek-backups/compose-iavek.patch. |

## 4. Se cair

1. **Ver se voltou:** o `docker inspect` (status running e reinícios) e a tela /login respondendo. O restart automático traz a peça de volta sozinho (hoje o app voltou em menos de 1 s).
2. **WhatsApp:** as 4 sessões em WORKING (channel_sessions.status, ou a API do WAHA). Depois, no log do WAHA, procurar 'Retrying n/15' sem um 200 depois (o WAHA tenta até 15 vezes; hoje as 10 falhas passaram na 2ª tentativa).
3. **Eventos parados:** webhook_events_log com status 'received' há mais de 2 min. Cada um precisa ter a versão 'processed' do mesmo payload.id e a linha em messages. Hoje eram 9, e os 9 foram reprocessados.
4. **Mensagens presas:** outbound com status 'queued' ou 'sending' há mais de 10 min. ANTES de pedir para reenviar, procurar na mesma conversa um eco com o mesmo texto e a assinatura, chegado logo depois com source='api': se existir, a mensagem SAIU, e reenviar faria o cliente receber em dobro (o caso de hoje, da Paloma). O cron recover-stuck-messages só recupera 'sending', não 'queued'.
5. **Envios que caíram na tela** (502 de POST /messages ou /media no log do caddy): não dá para saber a conversa pelo caddy. Avisar a loja que, se alguém viu erro ao enviar perto daquela hora, confira e reenvie.
6. **Quem avisar na loja:** o head de operação da Fenômenos (pelo Maestro), com a hora da queda, quanto tempo durou e o pedido de conferir os envios daquela janela. Se for a AP Clinic, o head dela.
7. **Registro:** um card no Notion (via Gestor) e uma nota no cofre.

## 5. Quando subir de máquina (gatilhos em números)

Subir de máquina é decisão do Rodrigo. Qualquer UM destes é o sinal:

- **7 dias seguidos** com o servidor em amarelo por mais de 1 h por dia (RAM disponível < 500 MB ou swap > 500 MB);
- **2 quedas por memória em 7 dias**, no app ou no WAHA, já com os tetos de hoje;
- a soma dos usos normais (app + WAHA + worker + ~550 MB fora do docker) passar de **3,1 GB**, que é 80% dos 3,9 GB;
- uma empresa nova ou um número novo de WhatsApp. SUPOSTO: cada sessão do WAHA soma uns 60 a 100 MB, e cada empresa do tamanho da Fenômenos soma uns 1.100 mensagens por dia. Antes de ligar, recalcular a soma do item acima;
- a CPU (load average) acima de 1,6 em 2 vCPU por mais de 15 min por dia durante 5 dias. Hoje: 0,4 (MEDIDO às 20:20Z).

Se subir, a ordem sugerida é 8 GB de RAM com 4 vCPU. Isso dobra a folga de tudo de uma vez, e os tetos podem ir para: app 1,5 GB (heap 1.024), WAHA 2 GB (heap 1.400) e worker 768 MB.
