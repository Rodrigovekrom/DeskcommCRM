-- manifest: ia.vek v1.9.62 (0649, CRM-497 4A; Lupa 1718, Maestro 193121) — o vendedor não ganha acesso a contato criando, reabrindo ou reapontando tarefa: gatilho em crm_tasks recusa (PT403) a tarefa ABERTA de um contato que ele não alcança sem tarefa
--
-- POR QUÊ: o acesso do vendedor ao contato vem também das tarefas dele (fn_iavek_contatos_do_vendedor; desde a 0647 só a
-- tarefa ABERTA, D4 4A do Rodrigo). Mas a tarefa é uma linha que o próprio vendedor escreve pelo REST:
--  - a crm_tasks_insert deixa qualquer agent da org criar tarefa; com assigned_to = ele e o contact_id de QUALQUER
--    contato, ele passava a ver esse contato (o furo EXISTE hoje na produção, achado em 21/11);
--  - a crm_tasks_update (0604) deixa quem é assigned_to reabrir a própria tarefa: o vendedor antigo reabria a tarefa
--    cancelada na passagem e voltava a ver o cliente (a regra 4A ficava furada).
-- A MUDANÇA (vale para toda org; só age onde a pessoa é VENDEDOR ou SDR de Follow-up, os que têm o contato restrito):
--  BEFORE INSERT OR UPDATE OF status, assigned_to, contact_id em crm_tasks, só na SESSÃO (auth.uid não nulo) de quem está
--  restrito nessa org (fn_iavek_orgs_onde_sou_vendedor): se a tarefa resultante é ABERTA (pending/in_progress), tem
--  contato, e NASCE, REABRE (de done/cancelled) ou muda de contato/responsável, o contato tem de estar ao alcance de
--  quem escreve SEM contar tarefa (lead dele, conversa dele, compromisso dele, contato criado por ele, o Follow-up da
--  SDR de Follow-up), ou ele já ter OUTRA tarefa ABERTA do mesmo contato (a delegada). Senão: PT403
--  'tarefa_fora_do_alcance' e nada é gravado. EXCEÇÃO de 5 min para o registro de ligação (que escreve pela sessão):
--  reabrir a própria tarefa recém-fechada como 'done', ou nascer outra dele do mesmo contato logo depois do fechamento.
--  A cancelada (a passagem) nunca entra na exceção.
--  NÃO toca: o servidor (a passagem, a esteira, os lotes, as rotas que escrevem pela chave de serviço: auth.uid nulo), a
--  gerência e a SDR (não estão restritas), a tarefa sem contato, a edição de uma tarefa já aberta sem mudar o contato.
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
    return new;  -- quem escreve não está restrito nesta org (gerência, SDR, admin)
  end if;
  if public.fn_iavek_alcanca_contato_sem_tarefa(v_uid, new.organization_id, new.contact_id)
     or new.contact_id in (select f.contato_id from public.fn_iavek_contatos_do_followup() f)
     -- já tem OUTRA tarefa ABERTA dele do mesmo contato (a delegada pela gerência): o acesso já existe, e a 2ª não abre nada
     or exists (select 1 from public.crm_tasks t2
                 where t2.organization_id = new.organization_id and t2.assigned_to = v_uid
                   and t2.contact_id = new.contact_id and t2.id <> new.id
                   and t2.status in ('pending', 'in_progress')) then
    return new;
  end if;
  -- O REGISTRO DA LIGAÇÃO (app/api/v1/_ligacao/registrar.ts, pela SESSÃO de propósito: Lupa) fecha a tarefa e, logo
  -- depois, cria a próxima ligação ou desfaz o fechamento se a linha do tempo falhar. Para o vendedor que só alcançava o
  -- contato por aquela tarefa, isso vale numa JANELA CURTA (5 min) depois de ela ser fechada como 'done': reabrir a
  -- própria tarefa recém-fechada, ou nascer outra dele do mesmo contato. A cancelada (a passagem) nunca entra aqui.
  if tg_op = 'UPDATE' and old.status = 'done' and old.updated_at > now() - interval '5 minutes' then
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
       select 1 from public.crm_tasks t3
        where t3.organization_id = new.organization_id and t3.assigned_to = v_uid
          and t3.contact_id = new.contact_id and t3.status = 'done'
          and t3.updated_at > now() - interval '5 minutes') then
    return new;
  end if;
  raise exception 'tarefa_fora_do_alcance: a tarefa aberta é de um contato que você não atende'
    using errcode = 'PT403';
end;
$$;
revoke execute on function public.fn_iavek_tarefa_nao_abre_contato() from public, anon, authenticated;

drop trigger if exists trg_iavek_tarefa_nao_abre_contato on public.crm_tasks;
create trigger trg_iavek_tarefa_nao_abre_contato
  before insert or update of status, assigned_to, contact_id on public.crm_tasks
  for each row execute function public.fn_iavek_tarefa_nao_abre_contato();
