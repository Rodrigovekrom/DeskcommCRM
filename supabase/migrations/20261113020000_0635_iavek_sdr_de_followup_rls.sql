-- manifest: ia.vek v1.9.52 (0635, CRM-254) — a RLS do SDR de Follow-up (função 'sdr_followup'): ele VÊ e EDITA todo lead do funil Follow-up da org (com dono ou sem), mas NÃO vê a entrada sem dono nem outra org; o contato e a conversa, só dos leads ABERTOS do Follow-up; e um gatilho impede que ele tire um lead do nome de um colega ou ponha no nome de um colega pela tela.
--
-- Desenho: ~/operacao/v1950-sdr-de-followup-desenho.md (Lupa 151233, 153805, 153826, 014015). R1 contato, R2 conversa,
-- R3 editar = ver (com o gatilho), R4 o custo (um helper security definer stable, chamado como (select ...)).
-- Nada muda para as outras funções: as cláusulas novas só valem para quem é sdr_followup ATIVO (role agent) na org.
-- Volta: voltar-0635.sql (as políticas e funções de antes; o helper e o gatilho saem).

-- R4: as (org, funil Follow-up da esteira) em que EU sou SDR de Follow-up ativo.
create or replace function public.fn_iavek_followups_que_cuido()
returns table(org_id uuid, pipeline_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select uo.organization_id, (o.settings->'esteira'->'followup'->>'pipeline_id')::uuid
    from public.user_organizations uo
    join public.organizations o on o.id = uo.organization_id
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and uo.role = 'agent'
     and uo.interface_settings->>'funcao' = 'sdr_followup'
     and (o.settings->'esteira'->'followup'->>'pipeline_id') is not null;
$$;
revoke execute on function public.fn_iavek_followups_que_cuido() from public, anon;
grant execute on function public.fn_iavek_followups_que_cuido() to authenticated;

-- R2: os contatos dos leads ABERTOS do Follow-up que cuido (a conversa e o contato vão por eles; o lead FECHADO não).
create or replace function public.fn_iavek_contatos_do_followup()
returns table(org_id uuid, contato_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.organization_id, l.contact_id
    from public.crm_leads l
    join public.fn_iavek_followups_que_cuido() f on f.org_id = l.organization_id and f.pipeline_id = l.pipeline_id
   -- (status) 'future' (Compra futura) entra: o lead segue sendo trabalhado no Follow-up (docs/iavek/compra-futura-impacto.md)
   where l.status in ('open', 'future') and l.contact_id is not null;
$$;
revoke execute on function public.fn_iavek_contatos_do_followup() from public, anon;
grant execute on function public.fn_iavek_contatos_do_followup() to authenticated;

-- A régua de visão da função: 'own' (o resto vem pela cláusula do Follow-up). Sem isto a trava do teste fica vermelha.
create or replace function public.fn_iavek_modo_da_funcao(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case public.fn_iavek_funcao_na_org(p_org)
    when 'vendedor' then 'own'
    when 'sdr_followup' then 'own'
    when 'suporte' then 'own_and_unassigned'
    when 'sdr' then
      case when coalesce((select o.settings->'iavek'->>'guardiao_ve_sem_dono'
                            from public.organizations o where o.id = p_org), 'true') = 'false'
           then 'own' else 'own_and_unassigned' end
    else null
  end;
$$;

-- R1: o contato. O sdr_followup tem a restrição de contato do vendedor (sem ela veria TODOS os contatos da loja), e os
-- contatos dele são os de sempre MAIS os dos leads abertos do Follow-up.
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
       and uo.interface_settings->>'funcao' in ('vendedor', 'sdr_followup');
end;
$$;

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
     where k.created_by_user_id = auth.uid()
    union
    select f.contato_id from public.fn_iavek_contatos_do_followup() f;
end;
$$;

-- crm_leads: VER (todo o funil Follow-up, inclusive o fechado: o histórico do lead fica) e EDITAR.
drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads for select using (
  (select public.fn_is_platform_admin())
  or organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono) where v.ve_tudo)
  or (owner_user_id = (select auth.uid())
      and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono)))
  or (owner_user_id is null
      and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono) where v.ve_sem_dono)
      and created_at >= coalesce(((select public.fn_iavek_corte_sem_dono()) ->> organization_id::text)::timestamptz, '-infinity'::timestamptz))
  or (sdr_user_id = (select auth.uid()) and organization_id in (select public.fn_user_org_ids()))
  -- 0635: o funil Follow-up inteiro, para o SDR de Follow-up
  or ((organization_id, pipeline_id) in (select f.org_id, f.pipeline_id from public.fn_iavek_followups_que_cuido() f))
);

-- R3: editar = ver. O WITH CHECK leva a mesma cláusula: o lead SEGUE no funil Follow-up (tirar de lá = negado). Quem
-- é dono pela tela é o gatilho abaixo que decide.
drop policy if exists "crm_leads_update" on public.crm_leads;
create policy "crm_leads_update" on public.crm_leads for update
using (
  public.fn_is_platform_admin_full()
  or (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent')
      and (public.fn_role_at_least(organization_id, 'manager')
           or public.fn_can_view_lead(organization_id, owner_user_id)
           or sdr_user_id = auth.uid()))
  or ((organization_id, pipeline_id) in (select f.org_id, f.pipeline_id from public.fn_iavek_followups_que_cuido() f))
)
with check (
  public.fn_is_platform_admin_full()
  or (organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent')
      and (public.fn_role_at_least(organization_id, 'manager')
           or public.fn_can_view_lead(organization_id, owner_user_id)
           or sdr_user_id = auth.uid()))
  or ((organization_id, pipeline_id) in (select f.org_id, f.pipeline_id from public.fn_iavek_followups_que_cuido() f))
);

-- Os vínculos do lead (os compromissos no dossiê): a mesma visão.
drop policy if exists "crm_lead_links_select" on public.crm_lead_links;
create policy "crm_lead_links_select" on public.crm_lead_links for select using (
  exists (select 1 from public.crm_leads l
           where l.id = crm_lead_links.lead_id
             and (public.fn_can_view_lead(l.organization_id, l.owner_user_id)
                  or (l.organization_id, l.pipeline_id) in (select f.org_id, f.pipeline_id from public.fn_iavek_followups_que_cuido() f)))
);

-- R2: a conversa, pelo contato dos leads ABERTOS do Follow-up.
drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations for select using (
  (select public.fn_is_platform_admin())
  or organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono) where v.ve_tudo)
  or (assigned_to_user_id = (select auth.uid())
      and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono)))
  or (assigned_to_user_id is null
      and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v(org_id, ve_tudo, ve_sem_dono) where v.ve_sem_dono))
  or ((organization_id, contact_id) in (select g.org_id, g.contato_id from public.fn_iavek_contatos_que_guardo() g(org_id, contato_id)))
  -- 0635: o contato dos leads abertos do Follow-up
  or ((organization_id, contact_id) in (select c.org_id, c.contato_id from public.fn_iavek_contatos_do_followup() c))
);

-- R3 (Lupa 014015): o DONO pela tela. Só para o UPDATE direto (current_user = 'authenticated'), só para quem é
-- sdr_followup na org do lead e NÃO é gerente/admin lá. Os caminhos do servidor (funções security definer, como a
-- passagem ao vendedor) passam: dentro delas o current_user é o dono da função.
create or replace function public.fn_iavek_trava_dono_do_followup()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  eu uuid := auth.uid();
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.owner_user_id is not distinct from old.owner_user_id then return new; end if;
  if coalesce(public.fn_iavek_funcao_na_org(old.organization_id), '') <> 'sdr_followup' then return new; end if;
  if public.fn_role_at_least(old.organization_id, 'manager') then return new; end if;
  if (old.owner_user_id is null and new.owner_user_id = eu)
     or (old.owner_user_id = eu and (new.owner_user_id is null or new.owner_user_id = eu)) then
    return new;
  end if;
  raise exception 'Este lead é de outra pessoa; peça ao gerente para passar.' using errcode = '42501';
end;
$$;

drop trigger if exists trg_iavek_trava_dono_do_followup on public.crm_leads;
create trigger trg_iavek_trava_dono_do_followup
  before update of owner_user_id on public.crm_leads
  for each row
  execute function public.fn_iavek_trava_dono_do_followup();
