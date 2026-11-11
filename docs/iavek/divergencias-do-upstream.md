# Divergências do ia.vek em relação ao upstream (DeskcommCRM)

O ia.vek não segue mais o upstream (ver `v1-troca.md`). Esta lista existe para quem fizer
um merge com o upstream: estes pontos **mudam um contrato** que o código de lá assume, e um
merge sem cuidado os quebraria ou seria quebrado por eles.

## `crm_leads.status` ganha `future` (v1.9.45, CRM-294, Compra futura)

- **O que mudou:** o status do lead não é mais só `open`, `won` ou `lost`. Ganhou
  `future`, o lead em Compra futura. O CHECK `crm_leads_status_enum` (é um CHECK em texto,
  não um tipo `enum` do Postgres) e o `crm_leads_closed_at_consistency` passaram a aceitar
  `future`.
- **Quem escreve:** só o gatilho `fn_crm_lead_close_on_stage`, a partir de
  `crm_stages.is_compra_futura`. Ele também reabre a partir de `future`.
- **No TypeScript:** `LeadStatus` em `lib/types/leads.ts` e os outros unions com
  `"open" | "won" | "lost"` incluem `"future"`.
- **Num merge:** todo código novo do upstream que trate "não é `open`" como fechado, ou que
  faça um `switch` exaustivo em `open`, `won` e `lost`, tem de decidir o que fazer com o
  `future`. Ver `compra-futura-impacto.md`, que lista onde isso já foi decidido.

## docker-compose.prod.yml do SERVIDOR: limites de memória (incidente de 11/11/2026, 19:05Z)

O app caiu com "JavaScript heap out of memory": sem NODE_OPTIONS, o Node escolhia sozinho 396 MB de heap
(metade do teto de 768m), e a queda veio em 368 MB de uso. O WAHA rodava com o heap de 16384 MB que a imagem
traz, num teto de 1280m: o Node dele nunca apertava a coleta e o contêiner vivia colado no teto.
Com a ordem do Rodrigo e a revisão da Lupa, o docker-compose.prod.yml DO SERVIDOR foi editado (com backup em
/root/iavek-backups/memoria-20261111T195229Z):

| Serviço | Antes | Depois |
|---|---|---|
| app | mem_limit 768m, heap automático (396 MB) | mem_limit 1024m, NODE_OPTIONS=--max-old-space-size=576 |
| waha | mem_limit 1280m, heap 16384 MB (da imagem) | mem_limit 1280m (igual), NODE_OPTIONS=--max-old-space-size=900 |

- Por que no compose e não num arquivo de acréscimo: o `dc()` do hostgator-setup-kit usa `-f docker-compose.prod.yml`
  fixo, então um override não seria lido numa troca. E não no .env: o .env também alimenta o worker (teto 512m).
- O `trocar-producao.sh` (ops) confere estes 4 valores depois de toda troca e avisa se mudarem.
- Numa atualização do upstream que traga um docker-compose.prod.yml novo, estas 2 edições têm de ser refeitas.
- (11/11, saúde do servidor) O worker ganhou `logging: *default-logging` (era o único serviço sem rotação de log).
  Backup em /root/iavek-backups/logs-worker-20261111T201203Z; o diff do `docker compose config` mostrou só esse bloco.

### ⚠️ Para quem rodar o update.sh do kit (Lupa, 11/11)
`/root/deskcommcrm` é um checkout git, e o `docker-compose.prod.yml` está modificado (`M`). O nosso
`trocar-producao.sh` não usa o `update.sh`: troca só a imagem, e não há risco. Já o `update.sh` do kit faz `git checkout <tag>`.
Se o `prod.yml` da tag nova for diferente, o checkout PARA ("would be overwritten"), e o update trava. O caminho:

    cd /root/deskcommcrm
    git diff docker-compose.prod.yml > /root/iavek-backups/compose-iavek.patch   # (já existe uma cópia de 11/11)
    git stash push docker-compose.prod.yml
    git checkout <tag>                 # ou deixe o update.sh seguir
    git apply --3way /root/iavek-backups/compose-iavek.patch   # reaplica os 3 blocos do ia.vek
    docker compose -f docker-compose.prod.yml config -q && git stash drop

E confira depois com o `trocar-producao.sh` (a conferência dos limites). Lembrete: o botão/fluxo "Atualizar agora"
(o update.sh) NUNCA é usado no ia.vek (desfaz a marca).
