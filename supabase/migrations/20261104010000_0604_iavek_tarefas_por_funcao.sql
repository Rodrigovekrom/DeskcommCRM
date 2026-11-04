-- manifest: ia.vek v1.9.17 (0604) — tarefas por função: quem tem função de carteira (vendedor, guardião, Suporte IA) lê e altera as tarefas que são dele ou dos leads dele; gerência, admin e quem não usa função seguem como antes. Por conjunto, sem custo por linha.
--
-- A REGRA (decisão do dono do produto, 04/11)
--   · admin, gerente e leitor: todas;
--   · agente SEM função, ou com outra função: todas, como hoje (empresa que não usa funções);
--   · vendedor: as dos leads de que é dono;
--   · guardião: as dos leads de que é dono e dos que passou;
--   · Suporte IA: as dos leads dela e dos sem dono humano;
--   · qualquer um: as atribuídas a ele e as que ele criou.
--   Criar tarefa não muda.
--
-- ADITIVA: 2 funções novas e 3 regras trocadas no lugar. Nenhum dado muda.

create or replace function public.fn_iavek_orgs_com_todas_as_tarefas()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select x.org
    from public.fn_user_org_ids() as x(org)
   where not (public.fn_user_role_in_org(x.org) = 'agent'
              and coalesce(public.fn_iavek_funcao_na_org(x.org), '') in ('vendedor', 'sdr', 'suporte'));
$$;
revoke execute on function public.fn_iavek_orgs_com_todas_as_tarefas() from public, anon;
grant execute on function public.fn_iavek_orgs_com_todas_as_tarefas() to authenticated, service_role;

create or replace function public.fn_iavek_leads_das_minhas_tarefas()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
    from public.fn_user_org_ids() as x(org)
    join public.crm_leads l on l.organization_id = x.org
   where public.fn_user_role_in_org(x.org) = 'agent'
     and (l.owner_user_id = auth.uid()
          or l.sdr_user_id = auth.uid()
          or (l.owner_user_id is null and public.fn_iavek_funcao_na_org(x.org) = 'suporte'));
$$;
revoke execute on function public.fn_iavek_leads_das_minhas_tarefas() from public, anon;
grant execute on function public.fn_iavek_leads_das_minhas_tarefas() to authenticated, service_role;

drop policy if exists crm_tasks_select on public.crm_tasks;
create policy crm_tasks_select on public.crm_tasks
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_iavek_orgs_com_todas_as_tarefas())
    or (organization_id in (select public.fn_user_org_ids())
        and (assigned_to = (select auth.uid())
             or created_by = (select auth.uid())
             or lead_id in (select public.fn_iavek_leads_das_minhas_tarefas())))
  );

drop policy if exists crm_tasks_update on public.crm_tasks;
create policy crm_tasks_update on public.crm_tasks
  for update using (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
        and (organization_id in (select public.fn_iavek_orgs_com_todas_as_tarefas())
             or assigned_to = (select auth.uid())
             or created_by = (select auth.uid())
             or lead_id in (select public.fn_iavek_leads_das_minhas_tarefas())))
  ) with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
  );

drop policy if exists crm_tasks_delete on public.crm_tasks;
create policy crm_tasks_delete on public.crm_tasks
  for delete using (
    (select public.fn_is_platform_admin_full())
    or (organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
        and (organization_id in (select public.fn_iavek_orgs_com_todas_as_tarefas())
             or assigned_to = (select auth.uid())
             or created_by = (select auth.uid())
             or lead_id in (select public.fn_iavek_leads_das_minhas_tarefas())))
  );
