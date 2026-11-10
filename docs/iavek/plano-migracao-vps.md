# Plano de ensaio: mudar o CRM do servidor HostGator para a VPS Hostinger (CRM-232)

Situação: **só documento.** Nada foi instalado, ligado ou lido no servidor de produção para escrever este plano.
Regra registrada: a mudança só acontece **depois de 11/11/2026** e **depois de um ensaio aprovado**. A troca de verdade só acontece com o "pode trocar" do Rodrigo, repassado pelo Maestro.

Legenda usada em todo o texto:
- **MEDIDO**: conferido com comando ou documento, com a data.
- **SUPOSTO**: ainda não conferido. Antes de virar número ou alerta, tem que ser medido (o passo 0 do ensaio faz isso).

---

## ⚠ Conflito com uma decisão registrada (ler antes de tudo)

A decisão de **02/11** (cofre, `02-DECISOES`) dizia: **2 servidores**, "um só para os agentes, um só para o CRM", para que **um erro de agente não atinja o CRM e as chaves fiquem separadas**.
Em **09/11**, o Rodrigo decidiu ficar com **uma VPS só (KVM 8)** e levar tudo para ela. Portanto, se o CRM for para essa VPS, os agentes e a produção passam a dividir a mesma máquina.

O plano abaixo segue a decisão de 09/11 e põe três barreiras no lugar da separação física:
1. O CRM roda num **usuário próprio do Linux** (ex.: `iavekcrm`), com o Docker dele. O usuário dos agentes (`maestri`) **não** entra no grupo `docker`, porque estar nesse grupo equivale a ser root e daria aos agentes acesso total à produção.
2. O `.env` da produção fica legível **só pelo root e pelo usuário do CRM**. Os agentes operam como fazem hoje: por SSH e por scripts que pedem aprovação.
3. **Limite de memória e de CPU** nos contêineres dos agentes e do CRM, para que um não derrube o outro (é o mesmo motivo do `mem_limit` do WAHA no compose).

**Decisão do Rodrigo:** aceitar essas barreiras, ou voltar a ter um servidor só para o CRM.

---

## 1. O que roda hoje no servidor HostGator

Fontes: `docker-compose.prod.yml` deste repo, a nota `01-SISTEMA/ambiente` do cofre e as medições de 10/11.

| Peça | Onde / como | Muda de lugar? |
|---|---|---|
| Servidor | `143.95.173.212`, SSH 22022, só por chave, pasta `/root/deskcommcrm`. MEDIDO 10/11: fica em **Vinhedo-SP** (rede Oracle), a ~5 ms da VPS nova | sai |
| **app** (Next.js) | `APP_IMAGE` = `ghcr.io/rodrigovekrom/iavek-crm:<tag>` | vai |
| **worker** (turno da IA, filas) | `WORKER_IMAGE` = `iavek-crm-worker:<mesma tag>` | vai, e **nunca pode rodar nos dois servidores ao mesmo tempo** |
| **scheduler** (crons do fork: estoque Altimus, esteira, relatório, tarefas vencidas) | `SCHEDULER_IMAGE` = `iavek-crm-scheduler:<mesma tag>` | vai, e **nunca pode rodar nos dois ao mesmo tempo** |
| **waha** (WhatsApp, motor NOWEB) | volumes `waha-data` (sessões pareadas) e `waha-media`, `mem_limit 1280m` | vai, e **a sessão nunca pode rodar nos dois ao mesmo tempo** |
| **redis** + **srh** | fila e cache, sem dado que precise ir junto (SUPOSTO: a fila está vazia no momento da parada; conferir) | sobe vazio |
| **caddy** | portas 80/443, HTTPS automático, volume `caddy-data` com os certificados | vai (com os certificados) |
| wacalls, asterisk, voice-agent | perfis `voz`/`telefonia`. SUPOSTO: desligados na produção; conferir com `docker ps` | não vai, se estiver desligado |
| **Banco** | **Supabase Pro na nuvem** (projeto "ia.vek CRM", sa-east-1). **Não fica no servidor** | **não muda** |
| **Mídias** | Storage do Supabase (nuvem) + volume `waha-media` | o Storage não muda; o volume vai |
| `.env` da produção | `/root/deskcommcrm/.env` (chaves, `APP_IMAGE`, `DOMAIN` etc.) | vai, copiado de servidor para servidor, sem passar por nenhum outro lugar |
| Arquivos da operação | `/root/iavek-imagem-anterior.txt`, `/root/iavek-trocas.log`, `/root/iavek-teste.env`, `/root/iavek-teste-usuarios.txt`, `/root/.docker/config.json` (token GHCR `iavek-servidor-ghcr`, vence 15/10/2027) | vão |
| Backup local | `backup.sh` do kit às **03:00** (dump do banco + sessões do WAHA), 14 dias em `backups/` | vai: cron novo |
| Backup externo | `/root/iavek-backup/enviar.sh` às **03:30** para o B2 (rclone crypt), com config em `/root/.config/iavek-backup/rclone.conf` | vai: cron + config |
| Outros crons do root | SUPOSTO: além dos dois backups, existe a linha do `event-log-drain` (`_common.sh`). O `agent.sh` está desligado desde 15/10 (a linha está guardada em `/root/iavek-agente-cron-linha.txt`) e **continua desligado** | conferir `crontab -l` no passo 0 |
| SSH endurecido | `/etc/ssh/sshd_config.d/00-iavek.conf` (só chave) | refazer na VPS |
| Domínio e DNS | `iavekcrm.com` na HostGator: NS, zona DNS, e-mail `suporte@` (cPanel) e registros da Resend. MEDIDO 10/11: `crm.iavekcrm.com A 143.95.173.212`, **TTL 600 s** | muda **só o registro A do `crm`** |

O que **não** muda: o banco, o Storage, a Resend (e-mail), a Anthropic, o GHCR e os endereços de webhook (eles usam o domínio, não o IP; SUPOSTO para o webhook da Meta, conferir no `.env` se `META_WEBHOOK_BASE_URL` usa o domínio).

---

## 2. O ensaio na VPS, sem tocar a produção

Princípio: no ensaio, **nada do servidor novo fala com a produção.** Ele usa o **banco de teste** (como o canário faz desde 20/10), um **número de WhatsApp de teste** e outro endereço. O que vem da produção são **cópias**: imagem, compose, backup e certificados. Elas servem para provar que tudo abre e funciona.

### Passo 0: medir o que hoje é suposto (só leitura, depois de a chave nova ser liberada)
Pelo `ssh iavek-crm` (a chave da VPS), sem mudar nada:
- `docker ps` e `docker inspect`: quais contêineres e imagens estão de pé e quanto cada um ocupa (`docker stats --no-stream`);
- `crontab -l` do root: a lista completa de crons;
- tamanho dos volumes `waha-data`, `waha-media` e `caddy-data` e do backup mais novo (`du -sh`), para calcular o tempo de cópia;
- nomes das variáveis do `.env` (**só os nomes**, nunca os valores) que contêm IP ou endereço (`*_URL`, `DOMAIN`);
- no Supabase: se **Network Restrictions** está ligado. Se estiver, o IP `187.53.100.12` tem que entrar na lista **antes** da troca, senão o app novo não conecta no banco. Só o Rodrigo vê isso, no painel.

### Passo 1: preparar a VPS (precisa de root; ver seção 4)
Usuário `iavekcrm`, Docker, firewall (22022/80/443) e SSH só por chave. Nada sobe ainda.

### Passo 2: copiar o backup e provar que ele volta
- Baixar do B2 o backup mais novo (banco + WhatsApp) e decifrar. É o mesmo roteiro do `testar-restauracao.sh`, mas rodando na VPS.
- Carregar o dump num **Postgres 17 descartável, sem rede**, e conferir tabela por tabela que todas as linhas entraram. Mostrar só contagens, nunca dado de cliente.
- Abrir o pacote do WAHA e conferir que a sessão está dentro. **Sem ligar o WAHA com essa sessão** (ver risco R1).
- Apagar o Postgres descartável no fim, dê certo ou errado. Dado de cliente não fica parado na VPS.

### Passo 3: subir o CRM numa porta separada
- Usar a mesma tag de imagem que está na produção (`APP_IMAGE`/`WORKER_IMAGE`/`SCHEDULER_IMAGE`).
- Montar o `.env` em camadas, igual ao `canario.sh`: o da produção **menos tudo o que aponta para ela**, mais o `iavek-teste.env` (Supabase de teste), com Resend, Sentry e Nuvemshop desligados.
- Subir app, worker, scheduler, WAHA, redis e srh. O Caddy fica em outra porta (ex.: 8443) ou atrás do link com senha da parte 3 do pedido "operação 100% na VPS".
- O compose ganha um **nome de projeto diferente** (`-p iavek-ensaio`), para não confundir com a instalação de verdade, que vai morar ao lado.

### Passo 4: conferir (a lista é a aprovação do ensaio)
| O quê | Como prova |
|---|---|
| Saúde | `/api/v1/health?verbose=1` = healthy; `/login` 200; `/app` 307 |
| Login | entrar com um usuário fictício (`iavek-teste-usuarios.txt`) e com o convite |
| Conversas | abrir o Inbox do banco de teste, mandar e receber uma mensagem |
| Mídias | abrir uma imagem e um áudio antigos (Storage) e mandar uma mídia nova |
| WhatsApp | parear um **número de teste** por QR, mandar e receber, reiniciar o WAHA e ver a sessão voltar sozinha (`WHATSAPP_RESTART_ALL_SESSIONS`) |
| IA | um turno do worker responde no número de teste (custo pelo `llm_calls`) |
| Crons | o scheduler roda um ciclo (ex.: `estoque-altimus` contra a org de teste) |
| Backup | `backup.sh` + `enviar.sh` do ensaio gravam numa pasta **separada** do B2 (`iavek:ensaio`), nunca na `iavek:diario` |
| Medida | tempo que levou cada passo, que vira o tempo previsto do dia da troca |

### Passo 5: desmontar
`docker compose -p iavek-ensaio down -v` e apagar as cópias. Fica só o relatório do ensaio (prints, saídas, tempos), anexado ao CRM-232.

---

## 3. O dia da troca

**Quando:** depois de 11/11, com o ensaio aprovado e o "pode trocar" do Rodrigo. Janela de pouco uso: **de madrugada, entre 00h30 e 02h30, longe dos backups das 03:00/03:30.** SUPOSTO: é o horário de menos uso; confirmar com as mensagens por hora no banco antes de marcar.

**Véspera (D-1):**
- baixar o TTL do registro `crm` de 600 s para **300 s** (Rodrigo, na zona DNS da HostGator);
- deixar na VPS as imagens já baixadas, o compose e o `.env` copiado (com as linhas de imagem iguais às da produção) e os crons escritos, mas **comentados**;
- copiar o volume `caddy-data` (os certificados), para que o HTTPS funcione no primeiro segundo, sem esperar o Let's Encrypt.

**Na hora (ordem fixa; cada passo só começa se o anterior deu certo):**
1. Backup na produção (`backup.sh`) e anotação das imagens no `/root/iavek-trocas.log`.
2. **Parar no servidor antigo: scheduler → worker → WAHA → app.** Parar, não apagar: os contêineres e os volumes ficam lá para a volta. Aqui começa o tempo fora do ar.
3. Tirar o pacote final das sessões do WAHA (`waha-data` + `waha-media`) e copiar direto de servidor para servidor (5 ms de distância, MEDIDO). Conferir com `sha256sum` nas duas pontas.
4. Na VPS: restaurar os volumes e subir **redis → srh → app → worker → scheduler → WAHA → caddy**. Conferir a saúde **pelo IP**, com `curl --resolve crm.iavekcrm.com:443:187.53.100.12`.
5. Trocar o registro **A de `crm.iavekcrm.com` para `187.53.100.12`** (Rodrigo, na HostGator). Mais nada muda no DNS: NS, e-mail, Resend e `suporte@` continuam iguais.
6. **Ponte enquanto o DNS se espalha:** o Caddy do servidor antigo passa a encaminhar para a VPS (`reverse_proxy https://187.53.100.12`), e o app, o worker e o WAHA antigos continuam parados. Assim quem ainda cai no IP velho chega no servidor novo, e não existe o risco de duas cópias rodando.
7. Conferir pelo domínio: `/login` 200, health ok, uma mensagem de WhatsApp real entra e sai, e o scheduler roda um ciclo.
8. Ligar os crons de backup na VPS e comentar os do servidor antigo. Na manhã seguinte, conferir o `ultimo-envio.txt`.

**Tempo fora do ar esperado:** SUPOSTO **10 a 20 minutos** (do passo 2 ao 4). O número de verdade sai do ensaio (passo 4, linha "Medida"). Durante a espera do DNS não deveria haver queda extra, por causa da ponte do passo 6.

**Como voltar em minutos (se o passo 4 ou o 7 falhar):**
1. Na VPS: parar scheduler, worker e WAHA (nunca deixar os dois rodando).
2. Se o WAHA novo **não chegou a conectar**, as sessões antigas continuam válidas: subir no servidor antigo **WAHA → app → worker → scheduler** e tirar a ponte do Caddy.
3. Se o WAHA novo **chegou a conectar**, copiar de volta o `waha-data` dele (é o mais recente) e só depois subir o antigo.
4. Voltar o registro A para `143.95.173.212`. Com o TTL em 300 s, o mundo vê a volta em até ~5 minutos. Quem cair no IP velho já está no servidor certo.

Previsto: **5 a 10 minutos** (SUPOSTO; ensaiar a volta também, no fim do ensaio).

**Depois:** o servidor HostGator fica **parado, sem ser apagado, por 7 dias**, como volta de segurança. O domínio, o DNS e o `suporte@` saem por último, como já está decidido (a trava do domínio vai até ~07/12).

---

## 4. O que precisa de root ou de Docker na VPS (hoje não tenho)

MEDIDO em 10/11, como usuário `maestri`: `sudo` pede senha, `docker` dá "permission denied" e o `linger` está desligado.

| Precisa | Para quê | Quem libera |
|---|---|---|
| Root, uma vez (senha ou chave do root pelo painel da Hostinger) | criar o usuário `iavekcrm`, instalar o Docker e o cron, endurecer o SSH | **Rodrigo** (dono da conta Hostinger) |
| Docker para o usuário `iavekcrm` (**não** para o `maestri`) | rodar o CRM. Ver o conflito no topo | Rodrigo decide; o Construtor executa como root uma vez |
| Firewall da Hostinger + `ufw`: abrir 80/443 e manter 22022 | HTTPS do CRM | Rodrigo (painel) |
| Cron do root (ou do `iavekcrm`) | backups 03:00/03:30 | quem tiver root |
| Senhas da cifra do backup (hoje no Keychain do Mac, item (a) da operação 100% na VPS) | o `enviar.sh` da VPS precisa delas, dentro do `rclone.conf` (600) | **Rodrigo**: decidir se elas vêm para a VPS |
| Token GHCR com `read:packages` | baixar as imagens privadas | copiar o atual (vence 15/10/2027) ou gerar um novo só para a VPS (melhor). Rodrigo |
| Network Restrictions do Supabase (se estiver ligado) | liberar o IP `187.53.100.12` | Rodrigo (painel do Supabase) |
| Zona DNS da HostGator | TTL na véspera, registro A no dia | Rodrigo |
| Número de WhatsApp de teste (chip ou número virtual) | parear no ensaio sem mexer no número da Fenômenos | Rodrigo |

---

## 5. Riscos

| # | Risco | Medido ou suposto | Como o plano trata |
|---|---|---|---|
| R1 | **Sessão do WhatsApp ligada em dois servidores** ao mesmo tempo derruba ou desconecta o número da Fenômenos e pode pedir um QR novo | SUPOSTO (comportamento esperado do WhatsApp multi-aparelho; não testado aqui de propósito) | o ensaio nunca liga a sessão da produção; no dia, parar o WAHA antigo **antes** de copiar e subir o novo |
| R2 | **Worker ou scheduler nos dois** ao mesmo tempo = resposta da IA em dobro e cron em dobro (estoque, relatório) | SUPOSTO (as filas e os crons não foram feitos para dois servidores; não testado de propósito) | ordem de parada fixa; a ponte do Caddy no lugar de duas cópias |
| R3 | Agentes e produção na mesma máquina: um agente com Docker = acesso total à produção | MEDIDO: o grupo `docker` equivale a root | usuário separado, `maestri` fora do grupo `docker`, limites de memória (ver o topo) |
| R4 | Supabase recusar o IP novo | SUPOSTO (não se sabe se Network Restrictions está ligado) | conferir no passo 0 e liberar antes |
| R5 | Propagação do DNS mais lenta que o TTL (cache de operadora) | MEDIDO: TTL 600 s hoje. A demora extra é SUPOSTO | TTL 300 na véspera + ponte do Caddy |
| R6 | HTTPS sem certificado no primeiro minuto | SUPOSTO | copiar o `caddy-data`; se falhar, o Caddy emite sozinho logo que o DNS apontar |
| R7 | Tempo de cópia das sessões e das mídias maior que o previsto | SUPOSTO (tamanho dos volumes não medido) | medir no passo 0; a rede entre os dois é de ~5 ms (MEDIDO) |
| R8 | Backup parar de rodar depois da troca (cron esquecido ou senha da cifra ausente) | SUPOSTO | passo 8 + conferir o `ultimo-envio.txt` na manhã seguinte; depende da decisão sobre as senhas (seção 4) |
| R9 | Banco mais lento a partir da VPS | MEDIDO 10/11: conexão TCP da VPS até o pooler do Supabase sa-east-1 entre ~6 e ~30 ms. A comparação com o servidor atual não foi medida | medir do servidor atual no passo 0 e comparar |
| R10 | Reembolso da Hostinger (30 dias): se a VPS for devolvida depois da troca, o CRM fica sem casa | MEDIDO: a compra foi em 09/11 e as condições do reembolso NÃO foram lidas (card do Rodrigo até 19/11) | só trocar **depois** de decidir se a VPS fica (KVM 8 ou 4) |
| R11 | Os IPs de suporte da HostGator que hoje entram no servidor deixam de existir na VPS | MEDIDO: são 10 chaves de suporte no `authorized_keys` atual | sem impacto: elas simplesmente não vão para a VPS |

---

## 6. Ordem de aprovações

1. Rodrigo: decidir o conflito do topo (barreiras ou servidor separado), as senhas do backup e o número de teste.
2. Rodrigo: liberar o root na VPS uma vez. Chave nova no servidor antigo para o passo 0 (o comando já foi mandado ao Maestro).
3. Construtor: passo 0 (só leitura) e ensaio (passos 1 a 5), com relatório e tempos ao Maestro.
4. Rodrigo aprova o ensaio, marca a janela e dá o "pode trocar", repassado pelo Maestro.
5. Dia da troca (seção 3); 7 dias com o servidor antigo parado; depois, desligar.
