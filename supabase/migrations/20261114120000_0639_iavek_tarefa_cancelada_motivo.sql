-- manifest: ia.vek v1.9.56 (0639) — a tarefa cancelada pelo SISTEMA guarda o MOTIVO (crm_tasks.cancelada_motivo)
--
-- POR QUÊ: as ligações da esteira que se fecham sozinhas (card 398; tabela em ~/operacao/propostas/
-- ligacoes-fecham-sozinhas-tabela.md) gravam 'cancelled' com o MOTIVO, nunca 'done' ('feita' é só de quem registrou a
-- ligação). Decidido (Maestro 003448): uma coluna ADITIVA, nula, em vez de metadata (o crm_tasks não tem metadata).
-- Esta migration é a parte que NÃO depende da tabela: a coluna e o gatilho de hoje (o lead que FECHA cancela as
-- tarefas) passando a gravar 'lead_fechou'. As regras novas (a seguinte substitui, etapa de compromisso, o cliente
-- respondeu, resposta de gente) vêm no código, só depois do OK do Rodrigo na tabela.
-- MEDIDO na produção (14/11): a coluna não existe; o gatilho em vigor é o da 0625 (o corpo abaixo = o dela + o motivo).
-- O ALTER ... ADD COLUMN nulo, sem default, é só de catálogo (a trava exclusiva é de instantes, sem reescrever a tabela).
-- Idempotente (if not exists; create or replace). Volta: voltar-0639.sql (ops): devolve a função da 0625 e DEPOIS tira
-- a coluna.

alter table public.crm_tasks add column if not exists cancelada_motivo text;
comment on column public.crm_tasks.cancelada_motivo is
  'ia.vek v1.9.56 (0639): por que o SISTEMA cancelou a tarefa (ex.: lead_fechou). Nulo = cancelada por gente ou antes da 0639.';

create or replace function public.fn_iavek_cancela_tarefas_do_lead_fechado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with canceladas as (
    update public.crm_tasks t
       set status = 'cancelled',
           cancelada_motivo = 'lead_fechou'  -- ia.vek 0639: o motivo de quem fechou (o sistema)
     where t.lead_id = new.id
       and t.organization_id = new.organization_id
       and t.status in ('pending', 'in_progress')
       -- ia.vek 0625: no GANHO, só a pré-venda. Perder e Compra futura: todas.
       and (new.status <> 'won'
            or t.source_kind like 'ligacao%'
            or t.source_kind in ('followup', 'promised_proposal', 'promised_followup'))
    returning t.id, t.organization_id, t.lead_id, t.contact_id, t.title
  )
  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type, actor_kind, reason, payload, metadata, performed_at)
  select c.organization_id, c.lead_id, c.contact_id, 'tarefas', c.id, 'task_cancelled', 'rule',
         case when new.status = 'won' then 'Tarefa cancelada: lead ganho (era da pré-venda)' else 'Tarefa cancelada: lead fechado' end,
         jsonb_build_object('motivo', 'lead_fechado', 'status_do_lead', new.status, 'titulo', left(c.title, 200)),
         jsonb_build_object('origem', 'gatilho_0639'), now()
    from canceladas c;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_cancela_tarefas_do_lead_fechado() from public, anon, authenticated;

notify pgrst, 'reload schema';
