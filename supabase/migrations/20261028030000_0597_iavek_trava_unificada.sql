-- manifest: ia.vek v1.9.4b — a trava de campos ao arrastar no Kanban e o selo 'Incompleto (faltam N)' passam a usar a MESMA lista da passagem do lead (contexto + carro, cidade, pagamento, entrada, troca, prazo), como o Rodrigo decidir; saem tags, fase, guardião, vendedor e parcela. Só troca a função; nenhum dado muda.
--
-- POR QUÊ: com duas listas (a do selo/arrastar, da v1.8.2, e a da passagem, da
-- v1.9.4), arrastar para Agendado pedia tags e parcela, e a passagem pedia
-- cidade e prazo. Uma lista só: o que a passagem exige é o que o selo mostra.
create or replace function public.fn_iavek_campos_que_faltam_do_lead(l public.crm_leads)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  -- ia.vek v1.9.4b (migration 0597, decisão do Rodrigo): a MESMA lista da
  -- passagem do lead (lib/iavek/passagem.ts) — o contexto e os 7 campos do
  -- handoff SDR → loja. Saem as tags, a fase, o guardião, o vendedor e a parcela.
  select array_remove(array[
    case when char_length(btrim(coalesce(l.description, ''))) >= 20
           or exists (select 1 from public.conversation_notes n join public.conversations c on c.id = n.conversation_id
                       where c.contact_id = l.contact_id and c.organization_id = l.organization_id)
           or exists (select 1 from public.lead_notes ln where ln.contact_id = l.contact_id and ln.organization_id = l.organization_id)
           or exists (select 1 from public.crm_lead_activities a
                       where a.lead_id = l.id and a.organization_id = l.organization_id
                         and a.type = 'iavek_passagem' and char_length(btrim(coalesce(a.payload->>'contexto', ''))) >= 20)
         then null else 'Contexto do atendimento' end,
    case when nullif(btrim(coalesce(l.custom_fields->>'carro_interesse', '')), '') is not null then null else 'Carro de interesse' end,
    case when nullif(btrim(coalesce(l.custom_fields->>'cidade', '')), '') is not null then null else 'Cidade / região' end,
    case when nullif(btrim(coalesce(l.custom_fields->>'forma_pagamento', '')), '') is not null then null else 'Forma de pagamento' end,
    case when coalesce(l.custom_fields->>'entrada_reais', '') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
         then null else 'Entrada (R$; 0 = sem entrada)' end,
    case when coalesce(l.custom_fields->>'tem_troca', '') in ('true', 'false') then null else 'Tem carro na troca?' end,
    case when coalesce(l.custom_fields->>'tem_troca', '') = 'true'
              and (nullif(btrim(coalesce(l.custom_fields->>'troca_modelo', '')), '') is null
                   or nullif(btrim(coalesce(l.custom_fields->>'troca_ano', '')), '') is null)
         then 'Troca: modelo e ano' else null end,
    case when nullif(btrim(coalesce(l.custom_fields->>'prazo_compra', '')), '') is not null then null else 'Prazo para comprar' end
  ], null)
  -- Só responde por lead da organização de quem pergunta (sessão); o serviço vê todos.
  where auth.uid() is null or l.organization_id in (select public.fn_user_org_ids());
$$;
