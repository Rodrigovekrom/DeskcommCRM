-- manifest: ia.vek v1.7 — SDR guardião do lead (crm_leads.sdr_user_id), passagem SDR→vendedor pela transferência da conversa, visibilidade do guardião e notificações pessoais (sino)
--
-- Primeira migration do fork ia.vek (o sistema não segue mais o upstream desde
-- 16/10/2026). ADITIVA: uma coluna, uma tabela, funções e gatilhos novos, e duas
-- policies AMPLIADAS (lead e conversa passam a ser lidos também pelo guardião).
-- Nada é apagado e nenhum dado existente muda.
--
-- O DESENHO
--   · O DONO continua sendo `crm_leads.owner_user_id` (o vendedor). O guardião
--     é `sdr_user_id`: quem tinha a FUNÇÃO "sdr" (user_organizations.
--     interface_settings.funcao) e passou o lead adiante.
--   · A passagem acontece pela TRANSFERÊNCIA DA CONVERSA: quando a conversa sai
--     de uma pessoa para outra, os leads ABERTOS do contato que eram de quem
--     passou (ou não tinham dono) vão junto para quem recebe. Se quem passou é
--     SDR, ele fica guardião. A mesma regra vale para a troca de dono direto no
--     lead (quadro, API).
--   · O guardião continua VENDO o lead e as conversas do contato mesmo com a
--     visibilidade 'own' / 'own_and_unassigned'.
--   · `notificacoes` é o sino pessoal: lead passado para mim; para o guardião,
--     etapa mudou, ganhou, perdeu, tarefa venceu. A linha não guarda texto com
--     dado pessoal (só ids e nomes de etapa): nome do contato e título do lead
--     são lidos na hora, e somem junto com o lead (on delete cascade).
--
-- Gatilhos não fazem HTTP (doutrina): só leem e escrevem tabelas.

-- ---- 1. guardião no lead ----
alter table public.crm_leads
  add column if not exists sdr_user_id uuid references auth.users(id) on delete set null;

create index if not exists crm_leads_sdr_user_idx
  on public.crm_leads (organization_id, sdr_user_id)
  where sdr_user_id is not null;

-- ---- 2. notificações pessoais ----
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null,
  lead_id uuid references public.crm_leads(id) on delete cascade,
  task_id uuid references public.crm_tasks(id) on delete cascade,
  ator_user_id uuid references auth.users(id) on delete set null,
  dados jsonb not null default '{}'::jsonb,
  lida_em timestamptz,
  created_at timestamptz not null default now(),
  constraint notificacoes_tipo_check check (tipo in (
    'lead_passado',
    'guardiao_etapa',
    'guardiao_ganho',
    'guardiao_perda',
    'guardiao_tarefa_vencida',
    'tarefa_vencida'
  ))
);

create index if not exists notificacoes_por_pessoa_idx
  on public.notificacoes (user_id, organization_id, created_at desc);
create index if not exists notificacoes_nao_lidas_idx
  on public.notificacoes (user_id, organization_id)
  where lida_em is null;

alter table public.notificacoes enable row level security;

drop policy if exists notificacoes_select_propria on public.notificacoes;
create policy notificacoes_select_propria on public.notificacoes
  for select to authenticated
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

drop policy if exists notificacoes_update_propria on public.notificacoes;
create policy notificacoes_update_propria on public.notificacoes
  for update to authenticated
  using (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  )
  with check (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
  );

-- Quem lê só marca como lida; criar é do servidor (gatilhos e service role).
revoke all on table public.notificacoes from anon, authenticated;
grant select on table public.notificacoes to authenticated;
grant update (lida_em) on table public.notificacoes to authenticated;
grant all on table public.notificacoes to service_role;

-- Tempo real: o sino escuta as próprias linhas (a RLS vale no realtime).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificacoes'
     ) then
    alter publication supabase_realtime add table public.notificacoes;
  end if;
end $$;

-- ---- 3. a função de quem trabalha na loja ----
create or replace function public.fn_iavek_funcao_do_membro(p_org uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select uo.interface_settings->>'funcao'
    from public.user_organizations uo
   where uo.organization_id = p_org
     and uo.user_id = p_user
     and uo.revoked_at is null
   limit 1;
$$;
revoke execute on function public.fn_iavek_funcao_do_membro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_funcao_do_membro(uuid, uuid) to service_role;

-- ---- 4. o guardião enxerga o contato que guarda ----
create or replace function public.fn_iavek_e_guardiao_do_contato(p_org uuid, p_contact uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return p_contact is not null
     and auth.uid() is not null
     and exists (
       select 1 from public.crm_leads l
        where l.organization_id = p_org
          and l.contact_id = p_contact
          and l.sdr_user_id = auth.uid()
     );
end;
$$;
revoke execute on function public.fn_iavek_e_guardiao_do_contato(uuid, uuid) from public, anon;
grant execute on function public.fn_iavek_e_guardiao_do_contato(uuid, uuid) to authenticated, service_role;

-- Policies AMPLIADAS: a regra de antes continua inteira, e o guardião entra
-- como mais um "ou". Mensagens e notas seguem a conversa (as policies delas
-- perguntam pela conversa visível), então não precisam mudar.
drop policy if exists crm_leads_select on public.crm_leads;
create policy crm_leads_select on public.crm_leads
  for select
  using (
    public.fn_can_view_lead(organization_id, owner_user_id)
    or (
      sdr_user_id = auth.uid()
      and organization_id in (select public.fn_user_org_ids())
    )
  );

drop policy if exists crm_leads_update on public.crm_leads;
create policy crm_leads_update on public.crm_leads
  for update
  using (
    public.fn_is_platform_admin_full()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent')
      and (
        public.fn_role_at_least(organization_id, 'manager')
        or public.fn_can_view_lead(organization_id, owner_user_id)
        or sdr_user_id = auth.uid()
      )
    )
  )
  with check (
    public.fn_is_platform_admin_full()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'agent')
      and (
        public.fn_role_at_least(organization_id, 'manager')
        or public.fn_can_view_lead(organization_id, owner_user_id)
        or sdr_user_id = auth.uid()
      )
    )
  );

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select
  using (
    public.fn_can_view_conversation(organization_id, assigned_to_user_id)
    or public.fn_iavek_e_guardiao_do_contato(organization_id, contact_id)
  );

-- ---- 5. passagem: troca de dono do lead → guardião ----
create or replace function public.fn_iavek_guardiao_na_troca_de_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id
     and old.owner_user_id is not null
     and new.owner_user_id is not null
     and new.sdr_user_id is null
     and coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, old.owner_user_id), '') = 'sdr'
  then
    new.sdr_user_id := old.owner_user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_guardiao_na_troca_de_dono() from public, anon, authenticated;

drop trigger if exists trg_iavek_guardiao_na_troca_de_dono on public.crm_leads;
create trigger trg_iavek_guardiao_na_troca_de_dono
  before update of owner_user_id on public.crm_leads
  for each row execute function public.fn_iavek_guardiao_na_troca_de_dono();

-- ---- 6. passagem: transferência da conversa leva o lead junto ----
create or replace function public.fn_iavek_lead_segue_a_conversa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to_user_id is not null
     and new.assigned_to_user_id is distinct from old.assigned_to_user_id
     and new.contact_id is not null
     and coalesce(new.is_group, false) = false
  then
    update public.crm_leads l
       set owner_user_id = new.assigned_to_user_id,
           owner_agent_id = null,
           owner_kind = 'user'
     where l.organization_id = new.organization_id
       and l.contact_id = new.contact_id
       and l.status = 'open'
       and (
         (l.owner_user_id is null and l.owner_agent_id is null)
         or l.owner_user_id = old.assigned_to_user_id
       )
       and l.owner_user_id is distinct from new.assigned_to_user_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_lead_segue_a_conversa() from public, anon, authenticated;

drop trigger if exists trg_iavek_lead_segue_a_conversa on public.conversations;
create trigger trg_iavek_lead_segue_a_conversa
  after update of assigned_to_user_id on public.conversations
  for each row execute function public.fn_iavek_lead_segue_a_conversa();

-- ---- 7. notificações do lead (dono novo e guardião) ----
create or replace function public.fn_iavek_notifica_mudanca_do_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
  v_etapa_de text;
  v_etapa_para text;
begin
  -- Lead passado para alguém (que não foi quem passou para si mesmo).
  if new.owner_user_id is not null
     and new.owner_user_id is distinct from old.owner_user_id
     and new.owner_user_id is distinct from v_ator
  then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id)
    values (new.organization_id, new.owner_user_id, 'lead_passado', new.id, v_ator);
  end if;

  -- O guardião fica sabendo do que acontece com o lead que ele guarda (menos
  -- do que ele mesmo fez).
  if new.sdr_user_id is not null and new.sdr_user_id is distinct from v_ator then
    if new.status is distinct from old.status and new.status in ('won', 'lost') then
      insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id, dados)
      values (
        new.organization_id, new.sdr_user_id,
        case when new.status = 'won' then 'guardiao_ganho' else 'guardiao_perda' end,
        new.id, v_ator,
        case when new.status = 'lost' and new.lost_reason is not null
             then jsonb_build_object('motivo', new.lost_reason)
             else '{}'::jsonb end
      );
    elsif new.stage_id is distinct from old.stage_id and new.status = 'open' then
      select name into v_etapa_de from public.crm_stages where id = old.stage_id;
      select name into v_etapa_para from public.crm_stages where id = new.stage_id;
      insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id, dados)
      values (
        new.organization_id, new.sdr_user_id, 'guardiao_etapa', new.id, v_ator,
        jsonb_build_object('de', v_etapa_de, 'para', v_etapa_para)
      );
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_notifica_mudanca_do_lead() from public, anon, authenticated;

drop trigger if exists trg_iavek_notifica_mudanca_do_lead on public.crm_leads;
create trigger trg_iavek_notifica_mudanca_do_lead
  after update of owner_user_id, stage_id, status on public.crm_leads
  for each row execute function public.fn_iavek_notifica_mudanca_do_lead();

-- ---- 8. tarefa vencida (o cron tarefas-vencidas emite task.overdue) ----
create or replace function public.fn_iavek_notifica_tarefa_vencida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_sdr uuid;
begin
  select t.id, t.organization_id, t.assigned_to, t.lead_id
    into v_task
    from public.crm_tasks t
   where t.id = new.entity_id
     and t.organization_id = new.organization_id;
  if not found then
    return null;
  end if;

  if v_task.assigned_to is not null then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, task_id)
    values (v_task.organization_id, v_task.assigned_to, 'tarefa_vencida', v_task.lead_id, v_task.id);
  end if;

  if v_task.lead_id is not null then
    select l.sdr_user_id into v_sdr
      from public.crm_leads l
     where l.id = v_task.lead_id and l.organization_id = v_task.organization_id;
    if v_sdr is not null and v_sdr is distinct from v_task.assigned_to then
      insert into public.notificacoes (organization_id, user_id, tipo, lead_id, task_id)
      values (v_task.organization_id, v_sdr, 'guardiao_tarefa_vencida', v_task.lead_id, v_task.id);
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_notifica_tarefa_vencida() from public, anon, authenticated;

drop trigger if exists trg_iavek_notifica_tarefa_vencida on public.event_log;
create trigger trg_iavek_notifica_tarefa_vencida
  after insert on public.event_log
  for each row
  when (new.event_type = 'task.overdue')
  execute function public.fn_iavek_notifica_tarefa_vencida();

-- ---- 9. o clone (esteira 72h → follow-up, troca de funil) herda o guardião ----
create or replace function public.fn_iavek_clone_herda_guardiao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origem uuid;
begin
  if new.sdr_user_id is null
     and new.source_metadata ? 'clonado_de'
     and (new.source_metadata->'clonado_de'->>'lead_id') ~* '^[0-9a-f-]{36}$'
  then
    v_origem := (new.source_metadata->'clonado_de'->>'lead_id')::uuid;
    select l.sdr_user_id into new.sdr_user_id
      from public.crm_leads l
     where l.id = v_origem and l.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_clone_herda_guardiao() from public, anon, authenticated;

drop trigger if exists trg_iavek_clone_herda_guardiao on public.crm_leads;
create trigger trg_iavek_clone_herda_guardiao
  before insert on public.crm_leads
  for each row execute function public.fn_iavek_clone_herda_guardiao();
