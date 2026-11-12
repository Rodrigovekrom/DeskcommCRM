-- manifest: ia.vek v1.9.49 (0632) — a régua de organização do fn_iavek_campos_que_faltam_do_lead em ordem barata (o selo "Incompleto" do quadro e o "Leads incompletos" do gerente)
--
-- POR QUÊ (MEDIDO na produção, 12/11, só leitura): depois da queda do Supabase, o pg_stat_statements pôs a RPC
-- fn_iavek_campos_que_faltam no topo (77 chamadas, média de 770 ms). Com o usuário logado, 943 leads levam ~1 s; sem
-- usuário (serviço), ~70 ms. O perfil (track_functions + pg_stat_xact_user_functions) mostrou o motivo: a régua de
-- organização de CADA lead chama o fn_user_org_ids, que chama o fn_support_context (~0,7 ms). Foram 944 chamadas,
-- 861 dos 999 ms.
-- O QUE MUDA: SÓ o WHERE do fn_iavek_campos_que_faltam_do_lead. Primeiro o caso sem usuário, depois o vínculo ATIVO
-- do usuário na organização do lead (o que o fn_user_org_ids já devolve, fora o 'analista_ficha'), e só então o
-- fn_user_org_ids inteiro (o caminho do suporte). O CASE garante a ordem. Quem responde é o MESMO de antes; o corpo
-- (os 6 campos e o contexto) é IDÊNTICO ao da 0612. Mesma assinatura, mesmos grants; o gatilho da trava (0597) e a
-- RPC de fora seguem iguais. Idempotente (create or replace). Volta: voltar-0632.sql (o corpo da 0612).

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
  -- ia.vek 0632 (incidente 12/11): a MESMA regra, em ordem barata. O fn_user_org_ids chama o fn_support_context
  -- (~0,7 ms) e rodava UMA VEZ POR LEAD: 943 leads = 944 chamadas, 861 de 999 ms (pg_stat_xact_user_functions).
  -- O membro ativo da organização responde no 2º ramo e o suporte só é consultado se ele falhar (o CASE garante
  -- a ordem). O resultado é o mesmo: fn_user_org_ids = os vínculos ativos (fora 'analista_ficha') + o suporte.
  where case
          when auth.uid() is null then true
          when exists (select 1 from public.user_organizations uo
                        where uo.user_id = auth.uid() and uo.organization_id = l.organization_id
                          and uo.revoked_at is null
                          and coalesce(uo.interface_settings->>'funcao', '') <> 'analista_ficha') then true
          else l.organization_id in (select public.fn_user_org_ids())
        end;
$$;

revoke execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) from public, anon;
grant execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) to authenticated, service_role;

notify pgrst, 'reload schema';
