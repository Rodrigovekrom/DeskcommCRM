-- Reversão da migration 0580 (ia.vek v1.7.4): devolve conversations_select à
-- forma da 0579 (função por linha). Use só em emergência — a 0580 não muda
-- dados, só a forma de avaliar a mesma regra.
--   bash ~/projects/ia-vek-crm/aplicar-migration-0580.sh reverter
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    public.fn_can_view_conversation(organization_id, assigned_to_user_id)
    or public.fn_iavek_e_guardiao_do_contato(organization_id, contact_id)
  );

drop function if exists public.fn_iavek_visao_de_conversas();
drop function if exists public.fn_iavek_contatos_que_guardo();
