-- manifest: ia.vek v1.9.62 (0647, CRM-497) — um cartão só: crm_leads.esteira_passou_em, o sinal administrativo nos 2 gatilhos de aviso/evento, sem 'guardiao_etapa' na troca de funil, e a tarefa só dá acesso ao contato enquanto aberta
--
-- POR QUÊ (Rodrigo 17/11 "sempre um cartão só"; desenho v5 7fe7db2f e v6 8201d8ce, Lupa): a passagem das 72h e a volta
-- pelo reengajo deixam de CLONAR e passam a MOVER o mesmo lead (código: lib/esteira/deps-reais.ts e
-- lib/iavek/passagem-servidor.ts). O banco precisa de 4 coisas para isso:
--  1. a coluna crm_leads.esteira_passou_em: "passou pela entrada e venceu as 72h" (os relatórios e a régua usam; no clone
--     era o created_at do clone);
--  2. o sinal `iavek.mudanca_administrativa` ('sim', SET LOCAL): o roteiro de dado da junção dos cartões antigos (CRM-524)
--     roda com ele, e então fn_emit_event_on_lead_change NÃO emite evento (nada de lead.won repetido às conversões de
--     anúncio) e fn_iavek_notifica_mudanca_do_lead NÃO avisa ninguém. SÓ o roteiro usa o sinal; a esteira NÃO;
--  3. fn_iavek_notifica_mudanca_do_lead: a troca de FUNIL (só a esteira troca: a API recusa pipeline_id, a P-01) não
--     avisa 'guardiao_etapa' (é a passagem, não um avanço). O 'lead_passado' a quem recebe segue IGUAL (a SDR ganha um
--     lead para trabalhar, como hoje pelo clone). O resto da função fica como a 0638;
--  4. (D4 4A do Rodrigo, 21/11) fn_iavek_contatos_do_vendedor: a tarefa só dá acesso ao contato enquanto ABERTA
--     (pending/in_progress), o mesmo filtro que a 0641 já usa para a SDR. Hoje a feita ou cancelada antiga também dava.
-- 5. fn_iavek_tarefas_da_passagem (D4 1A/3A): as tarefas na passagem, só do servidor.
-- Nenhuma tabela nova, nenhuma policy muda. A coluna é ADITIVA (nula para todo lead de antes).
-- Volta: voltar-0647.sql (as 3 funções como estavam e o drop da coluna).

alter table public.crm_leads add column if not exists esteira_passou_em timestamptz;
comment on column public.crm_leads.esteira_passou_em is
  'ia.vek v1.9.62 (0647, CRM-497): quando o lead passou da entrada ao Follow-up por vencer as 72h (o mesmo lead, sem clone). Uma 2ª passagem regrava; a anterior fica em source_metadata.passagem e na linha do tempo.';

-- 2. o evento: o mesmo corpo vigente (baseline, a versão do dono agente), com o sinal administrativo na frente.
create or replace function public.fn_emit_event_on_lead_change() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- ia.vek 0647 (CRM-497): a mudança ADMINISTRATIVA (o roteiro de dado, com SET LOCAL) não é um fato de negócio novo.
  if coalesce(current_setting('iavek.mudanca_administrativa', true), '') = 'sim' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'won' then
      perform public.fn_log_event(new.organization_id, 'lead.won',
        jsonb_build_object('lead_id', new.id, 'value_cents', new.value_cents));
    elsif new.status = 'lost' then
      perform public.fn_log_event(new.organization_id, 'lead.lost',
        jsonb_build_object('lead_id', new.id, 'lost_reason', new.lost_reason));
    elsif new.status = 'open' then
      perform public.fn_log_event(new.organization_id, 'lead.reopened',
        jsonb_build_object('lead_id', new.id));
    end if;
  end if;

  if new.owner_user_id is distinct from old.owner_user_id
     or new.owner_agent_id is distinct from old.owner_agent_id then
    perform public.fn_log_event(new.organization_id, 'lead.assigned',
      jsonb_build_object(
        'lead_id', new.id,
        'from_user_id', old.owner_user_id, 'to_user_id', new.owner_user_id,
        'from_agent_id', old.owner_agent_id, 'to_agent_id', new.owner_agent_id,
        'owner_kind', new.owner_kind));
  end if;

  return new;
end$$;

-- 3. os avisos: a 0638 inteira, mais o sinal e a troca de funil.
CREATE OR REPLACE FUNCTION public.fn_iavek_notifica_mudanca_do_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ator uuid := auth.uid();
  v_etapa_de text;
  v_etapa_para text;
  v_passagem boolean;
begin
  -- ia.vek 0647 (CRM-497): a mudança ADMINISTRATIVA (o roteiro de dado) não avisa ninguém.
  if coalesce(current_setting('iavek.mudanca_administrativa', true), '') = 'sim' then
    return null;
  end if;
  -- Lead passado para alguém (que não foi quem passou para si mesmo).
  -- ia.vek v1.9.52.3 (0638): a PASSAGEM ao Follow-up fecha o original como 'moved_to_another_pipeline'. Isso não é
  -- perda (o Meus números já exclui) nem lead novo para trabalhar: o original fechado que muda de dono não avisa
  -- 'lead_passado' (o aviso vem do CLONE, que é o lead de verdade).
  v_passagem := coalesce(new.status = 'lost' and new.lost_reason = 'moved_to_another_pipeline', false);
  if new.owner_user_id is not null
     and new.owner_user_id is distinct from old.owner_user_id
     and new.owner_user_id is distinct from v_ator
     and not v_passagem
  then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id)
    values (new.organization_id, new.owner_user_id, 'lead_passado', new.id, v_ator);
  end if;

  -- O guardião fica sabendo do que acontece com o lead que ele guarda (menos
  -- do que ele mesmo fez).
  if new.sdr_user_id is not null and new.sdr_user_id is distinct from v_ator then
    -- (0638) e a passagem NÃO avisa 'guardiao_perda' ao guardião (era ~1 aviso falso por passagem: 168 em 7 dias).
    if new.status is distinct from old.status and new.status in ('won', 'lost') and not v_passagem then
      insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id, dados)
      values (
        new.organization_id, new.sdr_user_id,
        case when new.status = 'won' then 'guardiao_ganho' else 'guardiao_perda' end,
        new.id, v_ator,
        case when new.status = 'lost' and new.lost_reason is not null
             then jsonb_build_object('motivo', new.lost_reason)
             else '{}'::jsonb end
      );
    -- (0647) a troca de FUNIL é a passagem da esteira (ida ao Follow-up ou volta à entrada), não um avanço de etapa.
    elsif new.stage_id is distinct from old.stage_id and new.status = 'open'
          and new.pipeline_id is not distinct from old.pipeline_id then
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
$function$;

-- 4. (D4 4A) a tarefa só dá acesso ao contato enquanto ABERTA. O resto é a 0635 (a versão vigente) igual.
create or replace function public.fn_iavek_contatos_do_vendedor()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select l.contact_id from public.crm_leads l
     where l.owner_user_id = auth.uid() and l.contact_id is not null
    union
    select c.contact_id from public.conversations c
     where c.assigned_to_user_id = auth.uid() and c.contact_id is not null
    union
    select a.contact_id from public.calendar_appointments a
     where a.owner_user_id = auth.uid() and a.contact_id is not null
    union
    select t.contact_id from public.crm_tasks t
     where t.assigned_to = auth.uid() and t.contact_id is not null
       and t.status in ('pending', 'in_progress')  -- ia.vek 0647 (D4 4A): só a tarefa ABERTA
    union
    select k.id from public.contacts k
     where k.created_by_user_id = auth.uid()
    union
    select f.contato_id from public.fn_iavek_contatos_do_followup() f;
end;
$$;

-- 5. (D4 1A/3A, desenho v6) as tarefas na PASSAGEM, numa função só do servidor: cancela as AUTOMÁTICAS abertas do lead
--    (a régua da esteira: ligacao:L1..L7 e ligacao:quente) com p_motivo_automaticas e, se p_motivo_de_pessoa vier, TODAS
--    as outras abertas (as de pessoa) com ele. Cada uma ganha a linha 'task_cancelled' (o mesmo formato da 0640).
--    Nenhuma tarefa é reatribuída: o novo dono recebe o lead limpo. Devolve {automaticas, de_pessoa}.
create or replace function public.fn_iavek_tarefas_da_passagem(
  p_org uuid,
  p_lead uuid,
  p_motivo_automaticas text,
  p_motivo_de_pessoa text default null,
  -- (P3 do Rodrigo, ponto único em lib/iavek/regras-da-passagem.ts) os source_kind de pessoa que NÃO são cancelados e
  -- seguem com o novo dono (ex.: as promessas da IA ao cliente). Vazio (hoje) = todas as de pessoa são canceladas.
  p_preservar text[] default '{}'::text[],
  p_novo_dono uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_auto constant text[] := array['ligacao:L1','ligacao:L2','ligacao:L3','ligacao:L4','ligacao:L5','ligacao:L6','ligacao:L7','ligacao:quente'];
  v_a integer;
  v_p integer := 0;
begin
  if p_motivo_automaticas is null or btrim(p_motivo_automaticas) = '' then
    raise exception 'tarefas_da_passagem: o motivo das automáticas é obrigatório' using errcode = '22023';
  end if;
  -- (Lupa 201732, OBRIGATÓRIO 3) as AUTOMÁTICAS pelo caminho que já existe: fn_iavek_cancela_ligacoes (0640), com o
  -- motivo em crm_tasks.cancelada_motivo (0639) e a linha task_cancelled dela.
  v_a := public.fn_iavek_cancela_ligacoes(p_org, array[p_lead], v_auto, p_motivo_automaticas, null, null);
  if p_motivo_de_pessoa is not null then
    with canceladas as (
      update public.crm_tasks t
         set status = 'cancelled', cancelada_motivo = p_motivo_de_pessoa
       where t.organization_id = p_org
         and t.lead_id = p_lead
         and t.status in ('pending', 'in_progress')
         and not coalesce(t.source_kind = any(v_auto), false)  -- source_kind nulo: null = any() é NULL
         and not coalesce(t.source_kind = any(p_preservar), false)
      returning t.id, t.organization_id, t.lead_id, t.contact_id, t.title, t.source_kind
    ), log as (
      insert into public.crm_lead_activities
        (organization_id, lead_id, contact_id, source_module, source_id, type, actor_kind, reason, payload, metadata, performed_at)
      select c.organization_id, c.lead_id, c.contact_id, 'tarefas', c.id, 'task_cancelled', 'rule',
             'Tarefa cancelada na passagem: ' || p_motivo_de_pessoa,
             jsonb_build_object('motivo', p_motivo_de_pessoa, 'ligacao', c.source_kind, 'titulo', left(c.title, 200),
                                'automatica', false),
             jsonb_build_object('origem', 'passagem_0647'), now()
        from canceladas c
    )
    -- (o insert do 'log' roda uma vez de qualquer jeito: CTE que escreve sempre executa; a conta sai das canceladas)
    select count(*) into v_p from canceladas;
    -- as preservadas (P3) seguem com o novo dono
    if p_novo_dono is not null and coalesce(array_length(p_preservar, 1), 0) > 0 then
      update public.crm_tasks t set assigned_to = p_novo_dono
       where t.organization_id = p_org and t.lead_id = p_lead and t.status in ('pending', 'in_progress')
         and t.source_kind = any(p_preservar);
    end if;
  end if;
  return jsonb_build_object('automaticas', coalesce(v_a, 0), 'de_pessoa', v_p);
end;
$$;
revoke execute on function public.fn_iavek_tarefas_da_passagem(uuid, uuid, text, text, text[], uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_tarefas_da_passagem(uuid, uuid, text, text, text[], uuid) to service_role;
