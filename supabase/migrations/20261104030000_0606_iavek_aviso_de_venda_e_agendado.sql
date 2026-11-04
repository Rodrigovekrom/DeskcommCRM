-- manifest: ia.vek v1.9.19 (0606) — na loja de carros, a venda avisa toda a loja em pop-up uma vez por pessoa (`notificacoes.popup_visto_em`), só gerente e admin corrigem valor e data de lead vendido, e mover para Agendado exige horário marcado ou pedido, recusado pelo banco; clínica e demais nichos não mudam.
--
-- ADITIVA: 1 coluna, 3 funções e 3 gatilhos em public.crm_leads. Nada é reescrito.
-- As regras só valem para o nicho loja de carros (ausente vale como loja, como em
-- `lerPerfilDaEmpresa` e na 0600). As duas travas valem para uma PESSOA (`auth.uid()`):
-- worker e chave de serviço seguem como antes.

alter table public.notificacoes add column if not exists popup_visto_em timestamptz;

create index if not exists idx_notificacoes_popup_pendente
  on public.notificacoes (user_id, created_at desc)
  where tipo = 'aviso_da_loja' and popup_visto_em is null;

-- ---- O aviso: "Fulano vendeu o Carro X", sem cliente e sem valor ----
-- Usa o carimbo do ciclo do carro (0600): o carro que depois sai do Altimus não gera
-- um segundo aviso, e o que volta ao estoque começa um ciclo novo.
create or replace function public.fn_iavek_aviso_de_venda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_carro uuid;
  v_nome text;
begin
  if coalesce((select o.settings->'iavek'->'perfil'->>'nicho' from public.organizations o
                where o.id = new.organization_id), 'loja_de_carros') <> 'loja_de_carros' then
    return null;
  end if;
  begin
    if new.custom_fields->>'carro_interesse' ~ '^[0-9a-fA-F-]{36}$' then
      update public.catalog_products p
         set aviso_da_loja_em = coalesce(p.aviso_da_loja_em, now())
       where p.id = (new.custom_fields->>'carro_interesse')::uuid
         and p.organization_id = new.organization_id
      returning p.id, p.nome into v_carro, v_nome;
    end if;
    insert into public.notificacoes (organization_id, user_id, tipo, ator_user_id, dados)
    select new.organization_id, uo.user_id, 'aviso_da_loja',
           coalesce(new.owner_user_id, auth.uid()),
           jsonb_build_object('evento', 'venda', 'carro_id', v_carro, 'carro_nome', v_nome)
      from public.user_organizations uo
     where uo.organization_id = new.organization_id
       and uo.revoked_at is null
       and uo.accepted_at is not null;
  exception when others then
    -- Um aviso que falha nunca desfaz a venda.
    raise warning 'aviso de venda falhou: %', sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_aviso_de_venda() from public, anon, authenticated;

drop trigger if exists trg_iavek_aviso_de_venda on public.crm_leads;
create trigger trg_iavek_aviso_de_venda
  after update of status on public.crm_leads
  for each row
  when (new.status = 'won' and old.status is distinct from 'won')
  execute function public.fn_iavek_aviso_de_venda();

-- ---- Depois de vendido, só gerente e admin corrigem valor e data ----
create or replace function public.fn_iavek_venda_so_gerente_corrige()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null
     or old.status <> 'won' or new.status <> 'won'
     or (new.value_cents is not distinct from old.value_cents
         and new.closed_at is not distinct from old.closed_at) then
    return new;
  end if;
  if coalesce((select o.settings->'iavek'->'perfil'->>'nicho' from public.organizations o
                where o.id = new.organization_id), 'loja_de_carros') <> 'loja_de_carros' then
    return new;
  end if;
  if not (public.fn_role_at_least(new.organization_id, 'manager')
          or coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, auth.uid()), '') in ('gerente', 'apoio')) then
    raise exception 'venda_so_gerente: só gerente e admin corrigem o valor e a data da venda'
      using errcode = 'PT403';
  end if;
  if coalesce(new.value_cents, 0) <= 0 or new.closed_at is null then
    raise exception 'venda_incompleta: informe o valor final e a data da venda';
  end if;
  if new.closed_at > now() + interval '1 minute' then
    raise exception 'venda_data_invalida: a data da venda não pode estar no futuro'
      using errcode = 'PT422';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_venda_so_gerente_corrige() from public, anon, authenticated;

drop trigger if exists trg_zz_iavek_venda_so_gerente_corrige on public.crm_leads;
create trigger trg_zz_iavek_venda_so_gerente_corrige
  before update of value_cents, closed_at on public.crm_leads
  for each row
  execute function public.fn_iavek_venda_so_gerente_corrige();

-- ---- Agendado exige horário: agendamento futuro ativo, ou pedido futuro não recusado ----
-- O nome faz este gatilho rodar DEPOIS do de campos obrigatórios (ordem alfabética).
create or replace function public.fn_iavek_agendado_exige_horario()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if not exists (select 1 from public.crm_stages s where s.id = new.stage_id and s.slug = 'agendado-video') then
    return new;
  end if;
  if coalesce((select o.settings->'iavek'->'perfil'->>'nicho' from public.organizations o
                where o.id = new.organization_id), 'loja_de_carros') <> 'loja_de_carros' then
    return new;
  end if;
  if exists (select 1 from public.calendar_appointments a
              where a.organization_id = new.organization_id
                and a.contact_id = new.contact_id
                and a.status in ('pending', 'confirmed')
                and a.starts_at > now())
     or exists (select 1 from public.iavek_pedidos_de_agendamento p
                 where p.organization_id = new.organization_id
                   and (p.lead_id = new.id or p.contact_id = new.contact_id)
                   and p.status in ('pendente', 'confirmado')
                   and p.quando > now()) then
    return new;
  end if;
  raise exception 'agendado_sem_horario: marque o dia e a hora antes de mover para Agendado'
    using errcode = 'PT422';
end;
$$;
revoke execute on function public.fn_iavek_agendado_exige_horario() from public, anon, authenticated;

drop trigger if exists trg_iavek_exige_horario_no_agendado on public.crm_leads;
create trigger trg_iavek_exige_horario_no_agendado
  before update of stage_id on public.crm_leads
  for each row
  execute function public.fn_iavek_agendado_exige_horario();
