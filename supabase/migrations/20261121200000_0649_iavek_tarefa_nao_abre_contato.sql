-- manifest: ia.vek v1.9.62 (0649, CRM-497 4A; Lupa 1718, Maestro 193121) — o vendedor não ganha acesso a contato criando, reabrindo ou reapontando tarefa: gatilho em crm_tasks recusa (PT403) a tarefa ABERTA de um contato que ele não alcança sem tarefa
--
-- POR QUÊ: o acesso do vendedor ao contato vem também das tarefas dele (fn_iavek_contatos_do_vendedor; desde a 0647 só a
-- tarefa ABERTA, D4 4A do Rodrigo). Mas a tarefa é uma linha que o próprio vendedor escreve pelo REST:
--  - a crm_tasks_insert deixa qualquer agent da org criar tarefa; com assigned_to = ele e o contact_id de QUALQUER
--    contato, ele passava a ver esse contato (o furo EXISTE hoje na produção, achado em 21/11);
--  - a crm_tasks_update (0604) deixa quem é assigned_to reabrir a própria tarefa: o vendedor antigo reabria a tarefa
--    cancelada na passagem e voltava a ver o cliente (a regra 4A ficava furada).
-- A MUDANÇA (vale para toda org; só age quando quem ESCREVE está restrito nessa org, vendedor ou SDR de Follow-up):
--  BEFORE INSERT OR UPDATE OF status, assigned_to, contact_id em crm_tasks, só na SESSÃO (auth.uid não nulo): se a
--  tarefa resultante é ABERTA (pending/in_progress), tem contato e responsável, e NASCE, REABRE (de done/cancelled) ou
--  muda de contato/responsável, e QUEM RECEBE (o assigned_to: é ele que ganha o acesso) também é restrito na org, o
--  contato tem de estar ao alcance DELE sem contar tarefa (lead, conversa, compromisso, contato criado; o Follow-up da
--  SDR de Follow-up quando ele é quem escreve), ou ele ter OUTRA tarefa ABERTA do mesmo contato (a delegada). Senão:
--  PT403 'tarefa_fora_do_alcance' e nada é gravado. SEM janela de tempo (Lupa 202249: o updated_at é o último toque, que
--  o vendedor escreve): o registro de ligação cria a próxima com a atual ainda aberta e só então fecha a atual.
--  NÃO toca: o servidor (auth.uid nulo), a gerência, a SDR e o admin (quem escreve não está restrito: delegar é dela), a
--  tarefa sem contato ou sem responsável, a edição de uma tarefa já aberta sem mudar o contato nem o responsável.
-- ADITIVA: 2 funções e 1 gatilho novos. Volta: voltar-0649.sql.

create or replace function public.fn_iavek_alcanca_contato_sem_tarefa(p_user uuid, p_org uuid, p_contato uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.crm_leads l
                  where l.organization_id = p_org and l.owner_user_id = p_user and l.contact_id = p_contato)
      or exists (select 1 from public.conversations c
                  where c.organization_id = p_org and c.assigned_to_user_id = p_user and c.contact_id = p_contato)
      or exists (select 1 from public.calendar_appointments a
                  where a.organization_id = p_org and a.owner_user_id = p_user and a.contact_id = p_contato)
      or exists (select 1 from public.contacts k
                  where k.organization_id = p_org and k.id = p_contato and k.created_by_user_id = p_user);
$$;
revoke execute on function public.fn_iavek_alcanca_contato_sem_tarefa(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.fn_iavek_tarefa_nao_abre_contato()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_alvo uuid;
  v_alvo_restrito boolean;
begin
  if v_uid is null or new.contact_id is null or new.status not in ('pending', 'in_progress') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('pending', 'in_progress')
     and new.contact_id is not distinct from old.contact_id
     and new.assigned_to is not distinct from old.assigned_to then
    return new;  -- a tarefa já aberta, editada sem mudar o contato nem o responsável
  end if;
  if new.organization_id not in (select public.fn_iavek_orgs_onde_sou_vendedor()) then
    return new;  -- quem escreve não está restrito nesta org (gerência, SDR, admin): delegar é dela
  end if;
  -- (Lupa 202249, ponto 2) quem GANHA o acesso é o assigned_to, não quem escreve: o alcance conferido é o DELE
  v_alvo := new.assigned_to;
  if v_alvo is null then
    return new;  -- tarefa sem responsável não abre contato a ninguém (fn_iavek_contatos_do_vendedor olha o assigned_to)
  end if;
  select exists (select 1 from public.user_organizations uo
                  where uo.user_id = v_alvo and uo.organization_id = new.organization_id and uo.revoked_at is null
                    and uo.role = 'agent' and uo.interface_settings->>'funcao' in ('vendedor', 'sdr_followup'))
    into v_alvo_restrito;
  if not v_alvo_restrito then
    return new;  -- quem recebe vê os contatos da org de qualquer jeito
  end if;
  if public.fn_iavek_alcanca_contato_sem_tarefa(v_alvo, new.organization_id, new.contact_id)
     -- o Follow-up da SDR de Follow-up: a função é do auth.uid, então só vale quando o alvo é quem escreve
     or (v_alvo = v_uid and new.contact_id in (select f.contato_id from public.fn_iavek_contatos_do_followup() f))
     -- o alvo já tem OUTRA tarefa ABERTA do mesmo contato (a delegada): o acesso já existe, e a 2ª não abre nada
     or exists (select 1 from public.crm_tasks t2
                 where t2.organization_id = new.organization_id and t2.assigned_to = v_alvo
                   and t2.contact_id = new.contact_id and t2.id <> new.id
                   and t2.status in ('pending', 'in_progress')) then
    return new;
  end if;
  raise exception 'tarefa_fora_do_alcance: a tarefa aberta é de um contato que quem a recebe não atende'
    using errcode = 'PT403';
end;
$$;
revoke execute on function public.fn_iavek_tarefa_nao_abre_contato() from public, anon, authenticated;

drop trigger if exists trg_iavek_tarefa_nao_abre_contato on public.crm_tasks;
create trigger trg_iavek_tarefa_nao_abre_contato
  before insert or update of status, assigned_to, contact_id on public.crm_tasks
  for each row execute function public.fn_iavek_tarefa_nao_abre_contato();
