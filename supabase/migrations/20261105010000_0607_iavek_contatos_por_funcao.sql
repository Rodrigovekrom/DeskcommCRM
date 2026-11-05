-- manifest: ia.vek v1.9.19.1 (0607) — o vendedor enxerga e altera só os contatos que são dele (leads, conversas, agendamentos e tarefas dele, e os que criou), e não apaga contato; as demais funções e a entrada de leads não mudam.
--
-- Muda 2 regras de acesso de `contacts` e cria 2 funções e 1 gatilho. Nenhum dado muda. Vale para
-- quem tem função vendedor e papel agente; worker e chave de serviço seguem como antes.

create or replace function public.fn_iavek_orgs_onde_sou_vendedor()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select uo.organization_id
      from public.user_organizations uo
     where uo.user_id = auth.uid()
       and uo.revoked_at is null
       and uo.role = 'agent'
       and uo.interface_settings->>'funcao' = 'vendedor';
end;
$$;
revoke execute on function public.fn_iavek_orgs_onde_sou_vendedor() from public, anon;
grant execute on function public.fn_iavek_orgs_onde_sou_vendedor() to authenticated, service_role;

create or replace function public.fn_iavek_contatos_do_vendedor()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select l.contact_id from public.crm_leads l
     where l.owner_user_id = auth.uid() and l.contact_id is not null
    union
    select c.contact_id from public.conversations c
     where c.assigned_to_user_id = auth.uid() and c.contact_id is not null
    union
    select a.contact_id from public.calendar_appointments a
     where a.owner_user_id = auth.uid() and a.contact_id is not null
    union
    select t.contact_id from public.crm_tasks t
     where t.assigned_to = auth.uid() and t.contact_id is not null
    union
    select k.id from public.contacts k
     where k.created_by_user_id = auth.uid();
end;
$$;
revoke execute on function public.fn_iavek_contatos_do_vendedor() from public, anon;
grant execute on function public.fn_iavek_contatos_do_vendedor() to authenticated, service_role;

drop policy if exists "tenant_isolation_contacts_read" on "public"."contacts";
create policy "tenant_isolation_contacts_read" on "public"."contacts" for select using (("organization_id" in (select public.fn_user_org_ids()) and ("organization_id" not in (select public.fn_iavek_orgs_onde_sou_vendedor()) or "id" in (select public.fn_iavek_contatos_do_vendedor()) or "created_by_user_id" = (select auth.uid()))) or public.fn_is_platform_admin());
drop policy if exists "tenant_isolation_contacts_write" on "public"."contacts";
create policy "tenant_isolation_contacts_write" on "public"."contacts" for all using (("organization_id" in (select public.fn_user_org_ids()) and ("organization_id" not in (select public.fn_iavek_orgs_onde_sou_vendedor()) or "id" in (select public.fn_iavek_contatos_do_vendedor()) or "created_by_user_id" = (select auth.uid()))) or public.fn_is_platform_admin_full()) with check (("organization_id" in (select public.fn_user_org_ids()) and ("organization_id" not in (select public.fn_iavek_orgs_onde_sou_vendedor()) or "id" in (select public.fn_iavek_contatos_do_vendedor()) or "created_by_user_id" = (select auth.uid()))) or public.fn_is_platform_admin_full());

create or replace function public.fn_iavek_vendedor_nao_apaga_contato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and old.organization_id in (select public.fn_iavek_orgs_onde_sou_vendedor()) then
    raise exception 'vendedor_nao_apaga_contato: o vendedor não exclui contato' using errcode = 'PT403';
  end if;
  return old;
end;
$$;
revoke execute on function public.fn_iavek_vendedor_nao_apaga_contato() from public, anon, authenticated;

drop trigger if exists trg_iavek_vendedor_nao_apaga_contato on public.contacts;
create trigger trg_iavek_vendedor_nao_apaga_contato
  before delete on public.contacts
  for each row
  execute function public.fn_iavek_vendedor_nao_apaga_contato();
