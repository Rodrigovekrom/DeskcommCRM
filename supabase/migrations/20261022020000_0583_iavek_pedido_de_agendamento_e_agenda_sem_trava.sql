-- manifest: ia.vek v1.7.6 — pedido de agendamento (SDR/IA pedem, o admin confirma com um clique) e agenda sem trava de horário (vários compromissos no mesmo horário); criar, remarcar e cancelar compromisso passa a ser só do admin
--
-- POR QUÊ (decisões do dono do produto, 21/10/2026)
--   · Não existe agenda pessoal. A agenda da loja é configurada e MEXIDA só
--     pelo admin (ou, no futuro, pela IA). O SDR e a IA NÃO marcam direto: eles
--     fazem um PEDIDO (cliente, dia e hora desejados, observação) e o admin
--     confirma, remarca ou recusa.
--   · O pedido NÃO reserva nem bloqueia horário.
--   · A loja tem 7 vendedores e atende mais de 10 pessoas ao mesmo tempo: a
--     agenda NÃO trava horário. Vários compromissos no mesmo horário são
--     permitidos. O admin pode pôr um teto em
--     organizations.settings.iavek.agenda_capacidade_por_horario (código).
--
-- O QUE MUDA
--   1. Tabela nova `iavek_pedidos_de_agendamento`. Quem lê: membros da
--      organização (todos veem a agenda). Quem escreve: só o servidor (service
--      role) — a sessão não tem INSERT/UPDATE/DELETE.
--   2. Sai o índice único calendar_appointments_sem_duplicata_idx (mesma
--      pessoa, mesmo instante): era a trava que a loja não quer.
--   3. calendar_appointments_write: de agent+ para admin (a IA e o servidor
--      escrevem por service role e não passam por aqui).
--
-- ADITIVA no que importa: nenhum dado é apagado nem alterado. O índice que sai
-- é só uma guarda; a tabela nova nasce vazia.

create table if not exists public.iavek_pedidos_de_agendamento (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- O que o pedido traz para o admin confirmar sem redigitar.
  quando timestamptz not null,
  event_type_id uuid references public.calendar_event_types(id) on delete set null,
  observacao text,
  -- Quem pediu: uma pessoa (SDR, vendedor) ou a IA.
  origem text not null default 'pessoa' check (origem in ('pessoa', 'ia')),
  pedido_por uuid references auth.users(id) on delete set null,
  pedido_por_agente uuid references public.ai_agents(id) on delete set null,
  status text not null default 'pendente'
    check (status in ('pendente', 'confirmado', 'recusado', 'cancelado')),
  decidido_por uuid references auth.users(id) on delete set null,
  decidido_em timestamptz,
  motivo_da_recusa text,
  -- O compromisso que o admin criou ao confirmar.
  appointment_id uuid references public.calendar_appointments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iavek_pedidos_observacao_tamanho check (observacao is null or length(observacao) <= 1000),
  constraint iavek_pedidos_quem_pediu check (
    (origem = 'pessoa' and pedido_por is not null) or origem = 'ia'
  )
);

create index if not exists iavek_pedidos_de_agendamento_pendentes_idx
  on public.iavek_pedidos_de_agendamento (organization_id, quando)
  where status = 'pendente';
create index if not exists iavek_pedidos_de_agendamento_por_pessoa_idx
  on public.iavek_pedidos_de_agendamento (organization_id, pedido_por, decidido_em);

alter table public.iavek_pedidos_de_agendamento enable row level security;

drop policy if exists iavek_pedidos_de_agendamento_select on public.iavek_pedidos_de_agendamento;
create policy iavek_pedidos_de_agendamento_select on public.iavek_pedidos_de_agendamento
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

revoke all on table public.iavek_pedidos_de_agendamento from anon, authenticated;
grant select on table public.iavek_pedidos_de_agendamento to authenticated;
grant all on table public.iavek_pedidos_de_agendamento to service_role;

-- LGPD: o pedido guarda TEXTO LIVRE (observação, motivo da recusa) que pode
-- nomear a pessoa. Na virada de `is_anonymized` do contato — a porta por onde
-- passam os dois caminhos de anonimização (desenho da 0391) — os dois campos
-- são apagados; o resto (dia/hora, status, quem pediu e decidiu) é dado de
-- operação da agenda e fica.
create or replace function public.fn_iavek_redigir_pedidos_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.iavek_pedidos_de_agendamento
     set observacao = null,
         motivo_da_recusa = null,
         updated_at = now()
   where contact_id = new.id
     and organization_id = new.organization_id
     and (observacao is not null or motivo_da_recusa is not null);
  return new;
end;
$$;
revoke execute on function public.fn_iavek_redigir_pedidos_ao_anonimizar() from public, anon, authenticated;

drop trigger if exists trg_iavek_redigir_pedidos_ao_anonimizar on public.contacts;
create trigger trg_iavek_redigir_pedidos_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and old.is_anonymized is distinct from true)
  execute function public.fn_iavek_redigir_pedidos_ao_anonimizar();

-- A agenda não trava horário (decisão da loja).
drop index if exists public.calendar_appointments_sem_duplicata_idx;

-- Criar, remarcar e cancelar compromisso: só o admin.
drop policy if exists calendar_appointments_write on public.calendar_appointments;
create policy calendar_appointments_write on public.calendar_appointments
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'admin'))
  );
