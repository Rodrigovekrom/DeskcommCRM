-- manifest: ia.vek v1.9.46 (0625) — GANHAR o lead cancela só as tarefas de PRÉ-VENDA (as ligações da esteira e da Compra futura, os follow-ups de venda e as promessas detectadas); a de pós-venda (entrega, documentação) e a feita à mão ficam pendentes. Perder e ir para Compra futura seguem cancelando todas.
--
-- POR QUÊ: nota 3 da Lupa na v1.9.45, decisão do Maestro (234646): "O espírito da decisão do Rodrigo é limpar o que
-- perdeu o sentido, não o que vem depois da venda." A 0621 cancelava TODAS as tarefas pendentes também no 'won'.
-- MEDIDO na produção (11/11): as tarefas são ligações da esteira (source_kind 'ligacao:L2/L3/L4/quente') e 1 feita à
-- mão; 0 com cara de pós-venda e 0 em lead ganho. Nada muda para os dados de hoje.
--
-- QUEM É PRÉ-VENDA (vocabulário de crm_tasks.source_kind, lib/tarefas/vocabulario-de-origem.ts):
--   'ligacao%' (a esteira e a Compra futura), 'followup' (o motor de follow-up, marcado a partir da v1.9.46),
--   'promised_proposal' e 'promised_followup' (os compromissos de venda detectados pelo assistente).
-- Todo o resto fica no ganho: a tarefa feita à mão (source_kind nulo), o 'proximo_passo' (pode ser de pós-venda) e as
-- de automação. Na dúvida, a tarefa FICA: cancelar a mais apaga trabalho; deixar a mais só pede um clique.
-- Idempotente (create or replace). Volta: voltar-0625.sql (devolve o corpo da 0621).

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
         jsonb_build_object('origem', 'gatilho_0625'), now()
    from canceladas c;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_cancela_tarefas_do_lead_fechado() from public, anon, authenticated;

notify pgrst, 'reload schema';
