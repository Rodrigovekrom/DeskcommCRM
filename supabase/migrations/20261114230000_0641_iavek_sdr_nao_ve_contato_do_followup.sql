-- manifest: ia.vek v1.9.59 (0641) — a SDR não vê o contato (nem a conversa SEM dono) do cliente que foi para o Follow-up (CRM-407 + CRM-273 parte 2)
--
-- Decisão do Rodrigo (14/11 ~18h35 SP, via Maestro): "contato do follow-up: esconder do sdr". Desenho:
-- ~/operacao/propostas/sdr-nao-ve-contato-do-followup-desenho.md, md5 b83f3066 (OK final da Lupa 215742).
--
-- SÓ para quem é 'sdr' (role agent, ativa na org). O contato fica ESCONDIDO dela quando: (1) ele tem lead ABERTO
-- ('open'/'future') no funil de Follow-up da org (settings.esteira.followup.pipeline_id; sem org fixa); (2) TODOS os
-- leads abertos dele estão no Follow-up; (3) ele NÃO é "dela" HOJE: lead aberto, conversa não fechada, agendamento
-- futuro ou tarefa aberta dela (Maestro 222446: lead fechado, tarefa cancelada e o contato que ela criou NÃO contam).
-- O número novo sem lead, e o contato que voltou (lead aberto fora do Follow-up), seguem visíveis.
--
-- Muda 3 políticas (o texto de antes + UMA cláusula): contacts read e write (0607) e conversations_select (0635), esta
-- na parte da conversa SEM dono e na do GUARDIÃO (Maestro 222635: a SDR guardiã do lead do Follow-up, de antes da 52.3).
-- A conversa com dono segue a 52.3/52.4. Nada muda para as outras funções.
-- O conjunto escondido é calculado 1 vez por consulta (security definer stable, chamado como (select …); o NOT IN é
-- descorrelacionado). Volta: voltar-0641.sql (ops): devolve as 3 políticas de antes e tira as funções.

-- os orgs em que EU sou SDR ativa
create or replace function public.fn_iavek_orgs_onde_sou_sdr()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select uo.organization_id
    from public.user_organizations uo
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and uo.role = 'agent'
     and uo.interface_settings->>'funcao' = 'sdr';
$$;
revoke execute on function public.fn_iavek_orgs_onde_sou_sdr() from public, anon;
grant execute on function public.fn_iavek_orgs_onde_sou_sdr() to authenticated, service_role;

-- o conjunto escondido de uma SDR (p_user), nas orgs em que ela é SDR ativa. Base das 2 de baixo.
create or replace function public.fn_iavek_escondidos_da_sdr(p_user uuid)
returns table(org_id uuid, contato_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- plpgsql de propósito: no baseline esta função fica no corpo, antes da policy de conversations, e o corpo plpgsql não
  -- é validado contra tabelas na criação (o sql seria)
  return query
  with minhas as (
      select uo.organization_id org, (o.settings->'esteira'->'followup'->>'pipeline_id')::uuid fu
        from public.user_organizations uo
        join public.organizations o on o.id = uo.organization_id
       where uo.user_id = p_user and uo.revoked_at is null and uo.role = 'agent'
         and uo.interface_settings->>'funcao' = 'sdr'
         and (o.settings->'esteira'->'followup'->>'pipeline_id') is not null
    ), dela as (
      -- (Maestro 222446) só o que está ABERTO hoje: lead fechado e tarefa cancelada de antes NÃO devolvem o contato
      select l.contact_id c from public.crm_leads l
       where l.owner_user_id = p_user and l.contact_id is not null and l.status in ('open', 'future')
      union select v.contact_id from public.conversations v
       where v.assigned_to_user_id = p_user and v.contact_id is not null and v.status not in ('closed', 'resolved', 'archived')
      union select a.contact_id from public.calendar_appointments a
       where a.owner_user_id = p_user and a.contact_id is not null and a.starts_at > now() and a.status in ('pending', 'confirmed')
      union select t.contact_id from public.crm_tasks t
       where t.assigned_to = p_user and t.contact_id is not null and t.status in ('pending', 'in_progress')
    )
    select distinct l.organization_id, l.contact_id
      from minhas m
      join public.crm_leads l on l.organization_id = m.org and l.pipeline_id = m.fu
     where l.status in ('open', 'future') and l.contact_id is not null
       and not exists (select 1 from public.crm_leads x
                        where x.organization_id = l.organization_id and x.contact_id = l.contact_id
                          and x.status in ('open', 'future') and x.pipeline_id is distinct from m.fu)
       and l.contact_id not in (select d.c from dela d where d.c is not null);
end;
$$;
revoke execute on function public.fn_iavek_escondidos_da_sdr(uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_escondidos_da_sdr(uuid) to service_role;

-- para a RLS: o conjunto de QUEM pergunta (vazio para quem não é SDR)
create or replace function public.fn_iavek_contatos_escondidos_da_sdr()
returns table(org_id uuid, contato_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select e.org_id, e.contato_id from public.fn_iavek_escondidos_da_sdr(auth.uid()) e;
$$;
revoke execute on function public.fn_iavek_contatos_escondidos_da_sdr() from public, anon;
grant execute on function public.fn_iavek_contatos_escondidos_da_sdr() to authenticated, service_role;

-- para o SERVIDOR (o 409 da criação de contato e da importação): este contato está escondido desta SDR?
create or replace function public.fn_iavek_contato_escondido_da_sdr(p_org uuid, p_user uuid, p_contato uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.fn_iavek_escondidos_da_sdr(p_user) e where e.org_id = p_org and e.contato_id = p_contato);
$$;
revoke execute on function public.fn_iavek_contato_escondido_da_sdr(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_contato_escondido_da_sdr(uuid, uuid, uuid) to service_role;

-- contacts: o texto da 0607 + a cláusula da SDR
drop policy if exists "tenant_isolation_contacts_read" on "public"."contacts";
create policy "tenant_isolation_contacts_read" on "public"."contacts" for select using (("organization_id" in (select public.fn_user_org_ids()) and ("organization_id" not in (select public.fn_iavek_orgs_onde_sou_vendedor()) or "id" in (select public.fn_iavek_contatos_do_vendedor()) or "created_by_user_id" = (select auth.uid())) and ("organization_id", "id") not in (select h.org_id, h.contato_id from public.fn_iavek_contatos_escondidos_da_sdr() h)) or public.fn_is_platform_admin());
drop policy if exists "tenant_isolation_contacts_write" on "public"."contacts";
create policy "tenant_isolation_contacts_write" on "public"."contacts" for all using (("organization_id" in (select public.fn_user_org_ids()) and ("organization_id" not in (select public.fn_iavek_orgs_onde_sou_vendedor()) or "id" in (select public.fn_iavek_contatos_do_vendedor()) or "created_by_user_id" = (select auth.uid())) and ("organization_id", "id") not in (select h.org_id, h.contato_id from public.fn_iavek_contatos_escondidos_da_sdr() h)) or public.fn_is_platform_admin_full()) with check (("organization_id" in (select public.fn_user_org_ids()) and ("organization_id" not in (select public.fn_iavek_orgs_onde_sou_vendedor()) or "id" in (select public.fn_iavek_contatos_do_vendedor()) or "created_by_user_id" = (select auth.uid()))) or public.fn_is_platform_admin_full());

-- conversations: o texto da 0635; só a conversa SEM dono ganha a cláusula (o contact_id nulo segue como antes)
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations for select using (
  (select public.fn_is_platform_admin())
  or organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono) where v.ve_tudo)
  or (assigned_to_user_id = (select auth.uid())
      and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono)))
  or (assigned_to_user_id is null
      and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono) where v.ve_sem_dono)
      -- 0641: a conversa sem dono do contato escondido da SDR
      and (contact_id is null or (organization_id, contact_id) not in (select h.org_id, h.contato_id from public.fn_iavek_contatos_escondidos_da_sdr() h)))
  or ((organization_id, contact_id) in (select g.org_id, g.contato_id from public.fn_iavek_contatos_que_guardo() g(org_id, contato_id))
      -- 0641 (Maestro 222635): a GUARDIÃ que é SDR também não vê a conversa do contato escondido dela (os passados antes da 52.3)
      and (organization_id, contact_id) not in (select h.org_id, h.contato_id from public.fn_iavek_contatos_escondidos_da_sdr() h))
  -- 0635: o contato dos leads abertos do Follow-up
  or ((organization_id, contact_id) in (select c.org_id, c.contato_id from public.fn_iavek_contatos_do_followup() c))
);

notify pgrst, 'reload schema';
