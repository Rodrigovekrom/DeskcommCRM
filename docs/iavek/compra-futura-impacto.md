# Compra futura (CRM-294): onde o status `future` mexe

O lead em **Compra futura** ganha um status novo, `future`. Hoje o status do lead é
`open`, `won` ou `lost`.

Opção B, aprovada pelo Maestro em 11/11 com 4 condições. Esta lista é a condição 1: ela
passa pela revisão da Lupa ANTES do código grosso.

**Como foi medida (11/11, branch `iavek/v1.9.45`):**

- **Banco:** a ÚLTIMA definição de cada função e gatilho do `supabase/baseline.sql` que
  cita `crm_leads` e compara o status do lead, mais os CHECKs, as policies e as views.
- **Código:** os 85 arquivos de `app`, `lib`, `components` e `hooks` (fora os testes) que
  comparam o status de um lead. Foram classificados por script e revistos à mão onde a
  comparação é "não é `open`".

## A regra de fundo

O status do lead é escrito por um gatilho só, `fn_crm_lead_close_on_stage` (P-02), a partir
da etapa. A etapa nova "Compra futura" (`crm_stages.is_compra_futura`) passa a dar
`status = 'future'`.

Por isso:

- **O que filtra `status = 'open'`** (o trabalho ativo) deixa o `future` de fora, como já
  faz com `won` e `lost`. A esteira não cobra nem move, e o radar e as cobranças não o
  veem. É o efeito pedido.
- **O que conta `won` ou `lost`** não conta o `future`. Ele nunca vira Perdido.
- **O que trata "não é `open`" como fechado** foi olhado um a um, abaixo.

---

## 1. Banco

### CHECKs de `crm_leads`

| CHECK | Hoje | Com `future` |
|---|---|---|
| `crm_leads_status_enum` | `open`, `won`, `lost` | + `future` |
| `crm_leads_closed_at_consistency` (Lupa) | `open` ⇒ `closed_at` nulo; `won`/`lost` ⇒ preenchido | `future` ⇒ `closed_at` **nulo** (não é fechado) **e** `compra_futura_mes` preenchido |
| `crm_leads_lost_reason_required` | `lost` ⇒ `lost_reason` | sem mudança (`future` não é `lost`) |
| novo | — | `compra_futura_mes` só com `status = 'future'`, e sempre no 1º dia do mês |

### Gatilhos

| Função | O que faz hoje | Com `future` |
|---|---|---|
| `fn_crm_lead_close_on_stage` (Lupa) | `is_won` ⇒ won; `is_lost` ⇒ lost; reabre SÓ se o antigo era `won`/`lost` | `is_compra_futura` ⇒ `future`. **Reabrir também a partir de `future`** (senão sair da etapa não reabre). Ao reabrir, limpa `compra_futura_mes` |
| novo: validação de entrada | — | entrar em Compra futura **exige** `compra_futura_mes`; **mês no passado é recusado** (condição 3 do Maestro) |
| `fn_emit_event_on_lead_change` | emite evento em won, lost e open | `future`: sem ramo, então **não emite** (nenhuma automação de "perdido" ou "ganho" dispara). `future` → `open` cai no ramo `open` e emite a reabertura; a esteira volta a valer (condição 2) |
| `fn_iavek_notifica_mudanca_do_lead` | avisa em won e lost | não avisa em `future` (não é venda nem perda) |
| `fn_validate_lost_reason_required` | exige motivo ao ir para perda | sem mudança |
| `fn_aplicar_quadro_do_onboarding` | cria etapas `is_won`/`is_lost` | sem mudança (a etapa Compra futura é criada à parte, só na Fenômenos) |

### Funções de leitura e de ação

| Função | Filtro | Com `future` |
|---|---|---|
| `fn_atrito_metrics` | conta `won`/`lost` | não entra (não é fechado nem perdido) |
| `fn_attendant_metrics` | won, lost, open | não entra em nenhuma das 3 contagens; ver a decisão D2 |
| `fn_iavek_assumir_da_faixa` | recusa se não `open` | recusa assumir um `future` (não é trabalho ativo) |
| `fn_iavek_avisar_trava`, `fn_iavek_aviso_de_ajuda`, `fn_iavek_faixa_de_ajuda` | só `open` | fora |
| `fn_iavek_lead_segue_a_conversa` | só `open` | fora: a conversa nova não "segue" o lead futuro; ver D1 |
| `fn_iavek_preco_do_carro_mudou` | só `open` | fora (não avisa preço a quem está em Compra futura) |
| `fn_iavek_rodizio_distribuir` | só `open` | fora do rodízio |
| `fn_iavek_trava_guardiao_do_lead` | só `open` | fora: a trava do guardião não protege o `future` |
| `fn_nascer_lead_da_conversa` (Lupa) | procura lead `open` | **não acha o `future`**, então nasce um lead NOVO no ciclo de 72h; ver **D1** |
| `fn_solicitar_reenvio_conversao` | só `won` | fora |
| **policies (RLS) e views** | nenhuma compara o status do lead | sem mudança |

---

## 2. Código: 85 arquivos

### 2a. "Só `open`" (38 arquivos): o `future` fica de fora, como `won` e `lost`

Esteira (`lib/esteira/deps-reais.ts`), radar e observador de risco, crons de campo de data,
de gatilho de tempo e de risco, painel, cartão, "meu dia", "meus números" (a contagem de
abertos), obrigatórios, padrão, passagem, pedidos de agendamento, assumir, sem dono,
primeira mensagem, rodízio, espaço do guardião, propostas, o handler e o quadro de leads
(as leituras secundárias), IA (`destino-da-intencao`, `runtime/tools`), automações
(`engine`, `create-or-move-lead`), entrada de canal (`pos-entrada`, `nascimento-do-lead`,
`active-lead`, `negocio-aberto-duplicado`), leitura da conversa, previsão, `routing/worker`.

**Efeito:** tudo isso deixa de agir sobre o lead futuro. É o pedido: "a esteira não cobra
nem move".

**A exceção que importa** é a entrada de canal (`nascimento-do-lead`, `active-lead`,
`negocio-aberto-duplicado`, `pos-entrada`): ver **D1**.

### 2b. "Só `won`/`lost`" (10 arquivos): o `future` não conta

`meu-dia` e `meus-numeros` (vendas e perdas do período), `metrics/lost`, o
`AcompanhamentoDoLead`, o `EditLeadDialog` e o `LeadFieldsForm` (a "venda fechada"), o
`FilterBar` (motivos de perda), `conversoes/envio` e `carro-do-anuncio`.

**Efeito:** o `future` nunca aparece como venda nem como perda. É o pedido: "nunca conta
como Perdido".

### 2c. "Não é `open`" (19 arquivos), revistos um a um

| Arquivo | Regra | Com `future` |
|---|---|---|
| `iavek/pipeline/assumir` | recusa se não `open` | recusa (certo: não é ativo) |
| `leads/[id]/move`, `leads/bulk`, `KanbanBoard` (372) | a regra de "venda" (≠ `won`) | não muda: `future` ≠ `won` |
| `leads/[id]/venda`, `CorrigirVenda` | só em `won` | fora |
| `conversoes/envio` (132) | ≠ `won` sem qualificação, não envia | não envia conversão para `future` (certo) |
| `carro-do-lead` (27, 38) | só `open` | fora |
| `cronometro-72h` (74) | só `open` conta as 72h | o relógio de 72h não corre no `future` (certo) |
| `ordem-do-quadro` (32) | só `open` entra na ordem | o `future` fica no fim da coluna dele |
| `painel-do-pipeline` (92) | só `open` tem "sem tarefa" e "parado há" | o `future` não aparece como parado (certo) |
| `kanban/filters` (258) | o filtro "ativos" | o `future` sai do filtro de ativos; ver **D3** |
| `appointment-stage-move`, `handoff-stage-move` | não movem lead fechado | não movem o `future` (certo: só o vendedor tira) |
| `clonar-para-funil` (116, 245) | não-open ⇒ "retomado" | clonar um `future` vira "retomado" (aceitável) |
| `previsao` (170) | só `open` | fora da previsão |
| `score-formula` (139) | não-open ⇒ nota congelada | a nota do `future` congela (certo) |
| `mcp/tools/retencao` (534) | a IA recusa encerrar o não-open | a IA não mexe no `future` |
| **`metrics/funil` (366 e a rota, linha 237)** | o que não é won/lost **vira "open"** | **o `future` contaria como ABERTO no funil**; ver **D2** |

### 2d. Tipos (7 arquivos): `"open" | "won" | "lost"`

`lib/types/leads.ts` (`LeadStatus`), `kanban/filters`, `agent-stage-sync`, `score-formula`,
`score-writer`, `metrics/funil` e `leads/_handler`. Passam a incluir `"future"`, e o
typecheck aponta todo `switch` que deixar de cobrir um caso.

---

## 3. LGPD, expurgo e retenção

- **LGPD** (`lib/lgpd/cascata.ts`, `redact-cascade.ts`, `export-collector.ts`, e as
  funções `fn_lgpd_*` do banco): a cascata e a exportação vão por **contato**, e não olham
  o status do lead. O `future` é anonimizado e exportado como qualquer lead. Sem mudança.
- **Expurgo e retenção** (`cron/data-retention`, `media-retention`): nenhuma regra por
  status de lead. Sem mudança.

---

## 4. Decisões para o Maestro (antes do código grosso)

### D1 (ponto da Lupa): o cliente em Compra futura volta a escrever

Hoje `fn_nascer_lead_da_conversa` e o lado do app (`active-lead`, `negocio-aberto-duplicado`)
procuram só lead `open`. Então nasce um lead NOVO no ciclo de 72h, e o `future` fica parado
lá.

**Recomendo:** a mensagem nova do cliente **reabre o lead futuro**. Ele volta para a 1ª
etapa aberta do funil dele, com o mesmo vendedor, e com uma atividade "voltou a falar". Não
nasce lead novo. A alternativa é deixar como está, com um lead novo, e o `future` vencendo
sozinho.

### D2: funil e métricas por atendente

Hoje o funil conta como "open" tudo o que não é won nem lost. **Recomendo** uma coluna
própria, "Compra futura", fora de aberto, ganho e perdido. O mesmo em
`fn_attendant_metrics`. É barato e evita inflar os abertos.

### D3: o filtro "ativos" do quadro

O `future` sai do filtro "ativos". **Recomendo** uma opção "Compra futura" no filtro de
status do quadro, para o gerente achar esses leads.

### Condição 3, a "Compra futura vencida"

Mês passado e ninguém agiu: o lead **não** volta sozinho a `open`. Ele aparece numa visão
para o gerente. É **barato**: é uma leitura (`status = 'future'` e `compra_futura_mes`
anterior ao mês atual) e uma seção no painel do gerente. Entra junto.
