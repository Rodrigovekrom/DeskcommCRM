-- manifest: ia.vek v1.9.1 — modo agendamento por empresa: no modo (settings.iavek.perfil.modo_agendamento), gerente/recepção marca na agenda e o banco recusa dois compromissos vivos sobrepostos para a mesma pessoa (trava por pessoa, PT409); função que cria o funil padrão de clínica. Fora do modo (a Fenômenos), nada muda.
--
-- POR QUÊ (pedido do Maestro, 26/10/2026 — cliente AP Clinic)
--   · A clínica agenda por profissional: uma cliente por horário. A loja
--     (v1.7.6, migration 0583) decidiu o contrário — vários compromissos no
--     mesmo horário e só o admin mexe na agenda. As duas decisões convivem
--     POR EMPRESA, pela chave `organizations.settings.iavek.perfil.
--     modo_agendamento` (v1.9.0, gravada só pelo admin da plataforma).
--   · O motor de horários já evita oferecer horário ocupado, mas "conferir e
--     depois gravar" deixa duas marcações simultâneas passarem. A guarda tem de
--     morar NO BANCO. `exclude using gist` não serve: `btree_gist` não existe
--     no baseline (ver 0177), e a regra vale só para algumas empresas. Então é
--     um gatilho com trava transacional por PESSOA (pg_advisory_xact_lock): a
--     segunda transação espera a primeira terminar e, ao conferir, já enxerga o
--     compromisso gravado.
--
-- O QUE MUDA
--   1. fn_iavek_modo_agendamento(org): a chave lida no banco (sem chave = false).
--   2. calendar_appointments_write: admin SEMPRE (como na 0583); gerente só
--      quando a empresa está no modo agendamento.
--   3. Gatilho trg_iavek_agenda_sem_duplo (BEFORE INSERT/UPDATE): no modo, um
--      compromisso vivo (pending/confirmed) com dono não pode cruzar outro vivo
--      do MESMO dono. Recusa com PT409 'agenda_horario_ocupado'.
--   4. fn_iavek_semear_funil_clinica(org): cria o funil "Clínica" (idempotente,
--      pelo slug) e o torna o padrão da empresa. Só o servidor chama.
--
-- ADITIVA: nenhuma linha muda. Para toda empresa SEM o modo (hoje, todas), o
-- gatilho sai na primeira linha e a política é a mesma da 0583.

-- SECURITY INVOKER de propósito: lê com os direitos de quem chama. Na política
-- da agenda, quem chama já é membro (fn_user_org_ids) e enxerga a própria
-- organização; no gatilho, quem chama já é definer. Uma definer com org no
-- argumento teria de conferir o pertencimento (cerca definer-membership-varredura).
create or replace function public.fn_iavek_modo_agendamento(p_org uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (settings->'iavek'->'perfil'->>'modo_agendamento')::boolean
       from public.organizations where id = p_org),
    false)
$$;
revoke execute on function public.fn_iavek_modo_agendamento(uuid) from public, anon;
grant execute on function public.fn_iavek_modo_agendamento(uuid) to authenticated, service_role;

drop policy if exists calendar_appointments_write on public.calendar_appointments;
create policy calendar_appointments_write on public.calendar_appointments
  using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (public.fn_role_at_least(organization_id, 'admin')
             or (public.fn_role_at_least(organization_id, 'manager')
                 and public.fn_iavek_modo_agendamento(organization_id))))
  )
  with check (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and (public.fn_role_at_least(organization_id, 'admin')
             or (public.fn_role_at_least(organization_id, 'manager')
                 and public.fn_iavek_modo_agendamento(organization_id))))
  );

create or replace function public.fn_iavek_agenda_sem_duplo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.owner_user_id is null or new.status not in ('pending', 'confirmed') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('pending', 'confirmed')
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at
     and new.owner_user_id is not distinct from old.owner_user_id then
    return new;
  end if;
  if not public.fn_iavek_modo_agendamento(new.organization_id) then
    return new;
  end if;
  -- Uma marcação por vez para a MESMA pessoa: a segunda espera a primeira
  -- terminar e então confere com o que já foi gravado.
  perform pg_advisory_xact_lock(hashtextextended('iavek_agenda:' || new.owner_user_id::text, 0));
  if exists (
    select 1 from public.calendar_appointments a
     where a.organization_id = new.organization_id
       and a.owner_user_id = new.owner_user_id
       and a.id <> new.id
       and a.status in ('pending', 'confirmed')
       and a.starts_at < new.ends_at
       and a.ends_at > new.starts_at
  ) then
    raise exception 'agenda_horario_ocupado' using errcode = 'PT409',
      detail = 'Já existe um compromisso desta pessoa neste horário.';
  end if;
  return new;
end
$$;
revoke execute on function public.fn_iavek_agenda_sem_duplo() from public, anon, authenticated;

drop trigger if exists trg_iavek_agenda_sem_duplo on public.calendar_appointments;
create trigger trg_iavek_agenda_sem_duplo
  before insert or update on public.calendar_appointments
  for each row execute function public.fn_iavek_agenda_sem_duplo();

create or replace function public.fn_iavek_semear_funil_clinica(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_pos numeric := 1000;
  r record;
begin
  select id into v_id from public.crm_pipelines where organization_id = p_org and slug = 'clinica';
  if v_id is not null then
    return v_id;
  end if;
  update public.crm_pipelines set is_default = false where organization_id = p_org and is_default;
  insert into public.crm_pipelines (organization_id, name, slug, is_default, position)
  values (p_org, 'Clínica', 'clinica', true, 500)
  returning id into v_id;
  for r in
    select * from (values
      ('Novo lead',          'novo_lead',          false, false),
      ('Em atendimento',     'em_atendimento',     false, false),
      ('Pré-agendado',       'pre_agendado',       false, false),
      ('Agendado',           'agendado',           false, false),
      ('Compareceu',         'compareceu',         false, false),
      ('Procedimento feito', 'procedimento_feito', true,  false),
      ('Não compareceu',     'nao_compareceu',     false, false),
      ('Perdido',            'perdido',            false, true)
    ) as t(nome, slug, won, lost)
  loop
    insert into public.crm_stages (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
    values (p_org, v_id, r.nome, r.slug, v_pos, r.won, r.lost);
    v_pos := v_pos + 1000;
  end loop;
  return v_id;
end
$$;
revoke execute on function public.fn_iavek_semear_funil_clinica(uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_semear_funil_clinica(uuid) to service_role;
