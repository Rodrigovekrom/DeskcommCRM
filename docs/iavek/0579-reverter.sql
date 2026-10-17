-- Desfaz a migration 0579 (ia.vek v1.7: guardião do lead e notificações).
-- Só para emergência, com OK do Rodrigo: volta as policies ao texto de antes,
-- tira os gatilhos e as funções, e APAGA a tabela `notificacoes` e a coluna
-- `crm_leads.sdr_user_id` (quem era guardião de quê se perde).
-- Rodar numa transação só:  psql ... -v ON_ERROR_STOP=1 --single-transaction

drop trigger if exists trg_iavek_clone_herda_guardiao on public.crm_leads;
drop trigger if exists trg_iavek_notifica_tarefa_vencida on public.event_log;
drop trigger if exists trg_iavek_notifica_mudanca_do_lead on public.crm_leads;
drop trigger if exists trg_iavek_lead_segue_a_conversa on public.conversations;
drop trigger if exists trg_iavek_guardiao_na_troca_de_dono on public.crm_leads;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select using (
    public.fn_can_view_conversation(organization_id, assigned_to_user_id)
  );

drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select using (
    public.fn_can_view_lead(organization_id, owner_user_id)
  );

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_lead(organization_id, owner_user_id)))
  ) with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'agent')
        and (public.fn_role_at_least(organization_id, 'manager')
             or public.fn_can_view_lead(organization_id, owner_user_id)))
  );

drop function if exists public.fn_iavek_clone_herda_guardiao();
drop function if exists public.fn_iavek_notifica_tarefa_vencida();
drop function if exists public.fn_iavek_notifica_mudanca_do_lead();
drop function if exists public.fn_iavek_lead_segue_a_conversa();
drop function if exists public.fn_iavek_guardiao_na_troca_de_dono();
drop function if exists public.fn_iavek_e_guardiao_do_contato(uuid, uuid);
drop function if exists public.fn_iavek_funcao_do_membro(uuid, uuid);

do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes'
  ) then
    alter publication supabase_realtime drop table public.notificacoes;
  end if;
end $$;

drop table if exists public.notificacoes;
drop index if exists public.crm_leads_sdr_user_idx;
alter table public.crm_leads drop column if exists sdr_user_id;
