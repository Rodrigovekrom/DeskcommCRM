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
