-- manifest: ia.vek v1.9.14 (0602) — desempenho sem mudar quem vê o quê: tarefas, atividades do lead e notas deixam de chamar função por linha; reserva da avaliação, para a nota não chamar a IA duas vezes
--
-- MEDIDO na produção (03/11): cada linha de tarefa custava cerca de 5 ms a quem não é
-- admin da plataforma (227 tarefas = 1,1 s por consulta), porque a regra de escrita era
-- "para tudo" e também rodava na leitura. Mesma classe em atividades (500 linhas = 2,4 s).
--
-- NADA MUDA em quem vê ou escreve o quê: as regras dizem o mesmo, avaliado uma vez por
-- consulta, como na 0580. Comparação por papel, antes e depois, fora deste repositório.

-- As organizações em que quem chama tem pelo menos este papel. Uma vez por consulta.
create or replace function public.fn_iavek_orgs_com_papel(p_min text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select x.org from public.fn_user_org_ids() as x(org) where public.fn_role_at_least(x.org, p_min);
$$;
revoke execute on function public.fn_iavek_orgs_com_papel(text) from public, anon;
grant execute on function public.fn_iavek_orgs_com_papel(text) to authenticated, service_role;

-- Tarefas: a de escrita sai de "para tudo" e vira uma por operação.
drop policy if exists crm_tasks_select on public.crm_tasks;
create policy crm_tasks_select on public.crm_tasks
  for select using (
    organization_id in (select public.fn_user_org_ids()) or (select public.fn_is_platform_admin())
  );
drop policy if exists crm_tasks_write on public.crm_tasks;
drop policy if exists crm_tasks_insert on public.crm_tasks;
create policy crm_tasks_insert on public.crm_tasks
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
  );
drop policy if exists crm_tasks_update on public.crm_tasks;
create policy crm_tasks_update on public.crm_tasks
  for update using (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
  ) with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
  );
drop policy if exists crm_tasks_delete on public.crm_tasks;
create policy crm_tasks_delete on public.crm_tasks
  for delete using (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('agent'))
  );

-- Atividades: o mesmo que fn_can_view_lead, em conjunto (fn_iavek_visao_de_conversas).
drop policy if exists "crm_lead_activities_select" on public.crm_lead_activities;
create policy "crm_lead_activities_select" on public.crm_lead_activities
  for select using (
    exists (
      select 1 from public.crm_leads l
       where l.id = crm_lead_activities.lead_id
         and ((select public.fn_is_platform_admin())
              or l.organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_tudo)
              or (l.owner_user_id = (select auth.uid())
                  and l.organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v))
              or (l.owner_user_id is null
                  and l.organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_sem_dono)))
    )
  );

-- Notas do atendimento: gerente e admin, em conjunto.
drop policy if exists iavek_notas_de_atendimento_select on public.iavek_notas_de_atendimento;
create policy iavek_notas_de_atendimento_select on public.iavek_notas_de_atendimento
  for select to authenticated
  using (organization_id in (select public.fn_iavek_orgs_com_papel('manager')));

-- A reserva da avaliação: quem reserva chama a IA; o outro espera a nota aparecer.
create table if not exists public.iavek_notas_reservas (
  event_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  criada_em timestamptz not null default now()
);
alter table public.iavek_notas_reservas enable row level security;
revoke all on table public.iavek_notas_reservas from anon, authenticated;
grant all on table public.iavek_notas_reservas to service_role;
