-- manifest: ia.vek v1.9.45 (0621) — perder, ganhar ou ir para Compra futura CANCELA as tarefas pendentes do lead (motivo "lead fechado" na linha do tempo); reabrir não as traz de volta; e o aviso de tarefa vencida não sai para tarefa de lead que não está 'open'
--
-- POR QUÊ: em 11/11 havia 453 tarefas pendentes de leads PERDIDOS, todas ligações da esteira e todas vencidas (77
-- delas na lista de 10 pessoas como "atrasadas"). O lead fechou, mas a tarefa seguia viva, e o aviso de tarefa vencida
-- continuava a sair. O Rodrigo (11/11, via Maestro 211102): "pode cancelar as tarefas dos leads fechados". Os dados de
-- 11/11 foram limpos à parte (cancelar-tarefas-fechados.sh, a rodada 'limpeza-2026-11-11'); esta migration impede
-- que se acumulem de novo.
--
-- O QUE FAZ:
--   1. fn_iavek_cancela_tarefas_do_lead_fechado + o gatilho AFTER UPDATE em crm_leads (com WHEN): quando o status
--      MUDA para 'lost', 'won' ou 'future', as tarefas 'pending'/'in_progress' do lead viram 'cancelled'. Cada uma ganha
--      uma linha 'task_cancelled' na linha do tempo do lead (ator 'rule', motivo 'Tarefa cancelada: lead fechado'),
--      no MESMO formato da limpeza de 11/11. O 'task_cancelled' não está na lista do fn_update_last_activity_at:
--      o lead fechado não ganha "atividade recente". Reabrir NÃO traz as tarefas de volta (de propósito).
--   2. fn_iavek_notifica_tarefa_vencida: não avisa tarefa que não está mais pendente, nem tarefa de lead que não está
--      'open'. Tarefa sem lead segue avisando como antes.
-- Idempotente (create or replace + drop trigger if exists). Nenhuma linha muda ao aplicar.
-- Volta: voltar-0621.sql (tira o gatilho e devolve o corpo de antes do aviso).

-- 1. cancelar as tarefas ao fechar o lead
create or replace function public.fn_iavek_cancela_tarefas_do_lead_fechado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with canceladas as (
    update public.crm_tasks t
       set status = 'cancelled'
     where t.lead_id = new.id
       and t.organization_id = new.organization_id
       and t.status in ('pending', 'in_progress')
    returning t.id, t.organization_id, t.lead_id, t.contact_id, t.title
  )
  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type, actor_kind, reason, payload, metadata, performed_at)
  select c.organization_id, c.lead_id, c.contact_id, 'tarefas', c.id, 'task_cancelled', 'rule',
         'Tarefa cancelada: lead fechado',
         jsonb_build_object('motivo', 'lead_fechado', 'status_do_lead', new.status, 'titulo', left(c.title, 200)),
         jsonb_build_object('origem', 'gatilho_0621'), now()
    from canceladas c;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_cancela_tarefas_do_lead_fechado() from public, anon, authenticated;

drop trigger if exists trg_iavek_cancela_tarefas_do_lead_fechado on public.crm_leads;
-- AFTER UPDATE (e não "update of status"): o status quase nunca está no SET. Quem muda a ETAPA é o update, e
-- quem muda o status é o gatilho BEFORE fn_crm_lead_close_on_stage. Um gatilho "of status" só dispara quando a
-- coluna está no SET do comando, e aqui nunca dispararia (pego na prova do TESTE). O WHEN compara o antes e o depois.
create trigger trg_iavek_cancela_tarefas_do_lead_fechado
  after update on public.crm_leads
  for each row
  when (new.status in ('lost', 'won', 'future') and old.status is distinct from new.status)
  execute function public.fn_iavek_cancela_tarefas_do_lead_fechado();

-- 2. o aviso de tarefa vencida: só tarefa pendente, e de lead aberto (ou sem lead)
create or replace function public.fn_iavek_notifica_tarefa_vencida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_sdr uuid;
  v_status_do_lead text;
begin
  select t.id, t.organization_id, t.assigned_to, t.lead_id, t.status
    into v_task
    from public.crm_tasks t
   where t.id = new.entity_id
     and t.organization_id = new.organization_id;
  if not found then
    return null;
  end if;

  -- ia.vek 0621: tarefa que não está mais pendente não vence (cancelada ou feita)
  if v_task.status not in ('pending', 'in_progress') then
    return null;
  end if;

  if v_task.lead_id is not null then
    select l.status, l.sdr_user_id into v_status_do_lead, v_sdr
      from public.crm_leads l
     where l.id = v_task.lead_id and l.organization_id = v_task.organization_id;
    -- ia.vek 0621: tarefa de lead que não está 'open' (perdido, ganho ou em Compra futura) não avisa
    if v_status_do_lead is distinct from 'open' then
      return null;
    end if;
  end if;

  if v_task.assigned_to is not null then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, task_id)
    values (v_task.organization_id, v_task.assigned_to, 'tarefa_vencida', v_task.lead_id, v_task.id);
  end if;

  if v_sdr is not null and v_sdr is distinct from v_task.assigned_to then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, task_id)
    values (v_task.organization_id, v_sdr, 'guardiao_tarefa_vencida', v_task.lead_id, v_task.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_notifica_tarefa_vencida() from public, anon, authenticated;

notify pgrst, 'reload schema';
