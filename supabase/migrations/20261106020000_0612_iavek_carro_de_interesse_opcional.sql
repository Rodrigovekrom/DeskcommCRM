-- manifest: ia.vek 0612 — o carro de interesse deixa de ser obrigatório ao mover de etapa (os outros campos obrigatórios ficam iguais); decisão do Rodrigo, 06/11
--
-- POR QUÊ: o carro vira texto livre com sugestão do estoque e deixa de travar a operação. Só a
-- linha do carro sai de `fn_iavek_campos_que_faltam_do_lead`; contexto, cidade, pagamento,
-- entrada, troca e prazo seguem obrigatórios onde a loja ligou a trava. Mesma assinatura, mesmos
-- grants. ADITIVA: só o corpo da função muda. Volta: voltar-0612.sql (o corpo da 0597).

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
  -- 0612 (Rodrigo, 06/11): o CARRO DE INTERESSE deixa de ser obrigatório; os outros ficam.
  select array_remove(array[
    case when char_length(btrim(coalesce(l.description, ''))) >= 20
           or exists (select 1 from public.conversation_notes n join public.conversations c on c.id = n.conversation_id
                       where c.contact_id = l.contact_id and c.organization_id = l.organization_id)
           or exists (select 1 from public.lead_notes ln where ln.contact_id = l.contact_id and ln.organization_id = l.organization_id)
           or exists (select 1 from public.crm_lead_activities a
                       where a.lead_id = l.id and a.organization_id = l.organization_id
                         and a.type = 'iavek_passagem' and char_length(btrim(coalesce(a.payload->>'contexto', ''))) >= 20)
         then null else 'Contexto do atendimento' end,
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
revoke execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) from public, anon;
grant execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) to authenticated, service_role;
