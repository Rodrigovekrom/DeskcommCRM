-- manifest: ia.vek v1.9.62 (0650, CRM-497 D4; Lupa 1718, Maestro 193121) — a passagem do lead por PESSOA numa transação só: fn_iavek_passar_lead trava o lead, confere o dono e as tarefas de pessoa abertas, troca o dono e fecha as automáticas
--
-- POR QUÊ: a passagem (app/api/v1/iavek/passagem e o agendamento que muda o dono) eram chamadas soltas do servidor:
-- "contar as tarefas abertas" e depois "trocar o dono" e depois "fechar as automáticas". Entre o contar e o trocar havia
-- janela: uma tarefa criada no meio ia junto com o lead (contra a D4 1A do Rodrigo), e uma falha no meio deixava o dono
-- trocado sem as automáticas fechadas.
-- A MUDANÇA: uma função SÓ do servidor (service_role), numa transação:
--  1. SELECT ... FOR UPDATE do lead (da org): aberto, senão {ok:false, motivo:'lead_fechado'};
--  2. o dono de agora tem de ser o que a rota conferiu (p_dono_anterior), senão {ok:false, motivo:'dono_mudou'} (outra
--     pessoa assumiu no meio: não passa por cima dela);
--  3. as tarefas de PESSOA abertas do lead (todas menos as automáticas ligacao:L1..L7|quente): com alguma,
--     {ok:false, motivo:'tarefas_abertas', tarefas:[...]} e NADA muda;
--  4. troca o dono (e o guardião, p_guardiao) e fecha as automáticas abertas com 'passou_o_lead'
--     (fn_iavek_tarefas_da_passagem, 0647). Devolve {ok:true, automaticas:n}.
-- Os gatilhos de crm_leads disparam como sempre (o aviso 'lead_passado' sai sem autor: a rota grava o autor depois, como
-- já fazia o caminho do servidor de mudarDono; a 0648 leva à coluna do vendedor quando não houve troca de etapa).
-- ADITIVA: 1 função nova. Volta: voltar-0650.sql.

create or replace function public.fn_iavek_passar_lead(
  p_org uuid,
  p_lead uuid,
  p_dono_anterior uuid,
  p_dono uuid,
  p_guardiao uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auto constant text[] := array['ligacao:L1','ligacao:L2','ligacao:L3','ligacao:L4','ligacao:L5','ligacao:L6','ligacao:L7','ligacao:quente'];
  v_lead record;
  v_tarefas jsonb;
  v_fecho jsonb;
begin
  if p_dono is null then
    raise exception 'passar_lead: o dono novo é obrigatório' using errcode = '22023';
  end if;
  select l.id, l.status, l.owner_user_id into v_lead
    from public.crm_leads l
   where l.organization_id = p_org and l.id = p_lead
   for update;
  if not found or v_lead.status is distinct from 'open' then
    return jsonb_build_object('ok', false, 'motivo', 'lead_fechado');
  end if;
  if v_lead.owner_user_id is distinct from p_dono_anterior then
    return jsonb_build_object('ok', false, 'motivo', 'dono_mudou');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'assigned_to', t.assigned_to,
                                               'due_date', t.due_date, 'status', t.status)
                            order by t.due_date nulls last), '[]'::jsonb)
    into v_tarefas
    from public.crm_tasks t
   where t.organization_id = p_org and t.lead_id = p_lead
     and t.status in ('pending', 'in_progress')
     and not coalesce(t.source_kind = any(v_auto), false);
  if jsonb_array_length(v_tarefas) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'tarefas_abertas', 'tarefas', v_tarefas);
  end if;
  update public.crm_leads
     set owner_user_id = p_dono, owner_kind = 'user', owner_agent_id = null,
         sdr_user_id = p_guardiao, assigned_at = now()
   where organization_id = p_org and id = p_lead;
  v_fecho := public.fn_iavek_tarefas_da_passagem(p_org, p_lead, 'passou_o_lead', null);
  return jsonb_build_object('ok', true, 'automaticas', coalesce((v_fecho->>'automaticas')::int, 0));
end;
$$;
revoke execute on function public.fn_iavek_passar_lead(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_passar_lead(uuid, uuid, uuid, uuid, uuid) to service_role;
