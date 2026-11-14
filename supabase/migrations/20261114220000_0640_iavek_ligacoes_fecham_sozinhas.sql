-- manifest: ia.vek v1.9.58 (0640) — as ligações da esteira FECHAM SOZINHAS (CRM-414; tabela aprovada pelo Rodrigo 14/11)
--
-- POR QUÊ: nenhuma ligação foi marcada como feita na história da Fenômenos (medido 14/11: L2 53 abertas, L3 376, L4 227,
-- quente 5), porque a L3 e a L4 seguem abertas mesmo quando a fase seguinte já começou. A tabela do Rodrigo ("ligações:
-- tabela como recomendada", 14/11 ~18h20 SP) diz quando cada uma fecha sozinha. Desenho revisado pela Lupa (213835).
--
-- A REGRA DE OURO: só EVENTO NOVO, nunca varredura. As vencidas de hoje NÃO saem por aqui (só pela limpeza à parte, com
-- frase do Rodrigo). A única via de uma tarefa antiga fechar é um evento novo do MESMO lead.
--
-- O QUE FECHA (só 'pending'/'in_progress', do MESMO lead e org; grava 'cancelled' + cancelada_motivo (0639) + 1
-- crm_lead_activities 'task_cancelled'; NUNCA 'done': "feita" é só de quem registrou a ligação):
--   1. nasce a L2…L7           → as L anteriores abertas (L1…L(k-1))           motivo 'proxima_ligacao'
--   2. nasce a 'quente'        → as L3…L7 abertas (L1/L2 seguem: resposta 2)    motivo 'cliente_respondeu'
--   3. o lead ENTRA numa etapa de compromisso (settings.esteira.entrada.etapas_de_compromisso DA ORG; sem org fixa)
--                              → TODAS as ligações abertas                       motivo 'etapa_de_compromisso'
--   4. uma PESSOA da equipe responde (sent_via 'user' COM sent_by_user_id; a régua da 0633. NÃO o external_device: por
--      ali sai a Venda.IA de fora, Lupa 213835) → a 'quente' aberta dos leads do contato, criada ANTES da mensagem
--                                                                                motivo 'equipe_respondeu'
--   (o lead fechou = a 0639, sem mudança)
--
-- SEGURANÇA (Lupa 213835): os 3 gatilhos envolvem o trabalho em 'exception when others then raise warning; return':
-- um erro aqui NUNCA derruba o INSERT da mensagem, a criação da ligação nem a troca de etapa.
-- A busca é pelo lead_id (crm_tasks_lead_idx); do contato ao lead, pelo idx_crm_leads_org_contact (não há índice de
-- contact_id no crm_tasks). O gatilho da messages tem WHEN: só as respostas de pessoa entram na função.
-- Idempotente (create or replace; drop trigger if exists). Volta: voltar-0640.sql (ops): tira os 3 gatilhos e as 4
-- funções; não mexe na 0639.

create or replace function public.fn_iavek_cancela_ligacoes(
  p_org uuid,
  p_leads uuid[],
  p_kinds text[],
  p_motivo text,
  p_antes timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  with canceladas as (
    update public.crm_tasks t
       set status = 'cancelled',
           cancelada_motivo = p_motivo
     where t.lead_id = any(p_leads)
       and t.organization_id = p_org
       and t.status in ('pending', 'in_progress')
       and t.source_kind = any(p_kinds)
       and (p_antes is null or t.created_at < p_antes)
    returning t.id, t.organization_id, t.lead_id, t.contact_id, t.title, t.source_kind
  ), log as (
    insert into public.crm_lead_activities
      (organization_id, lead_id, contact_id, source_module, source_id, type, actor_kind, reason, payload, metadata, performed_at)
    select c.organization_id, c.lead_id, c.contact_id, 'tarefas', c.id, 'task_cancelled', 'rule',
           'Ligação fechada sozinha: ' || p_motivo,
           jsonb_build_object('motivo', p_motivo, 'ligacao', c.source_kind, 'titulo', left(c.title, 200)),
           jsonb_build_object('origem', 'gatilho_0640'), now()
      from canceladas c
    returning 1
  )
  select count(*) into v_n from log;
  return v_n;
end;
$$;
revoke execute on function public.fn_iavek_cancela_ligacoes(uuid, uuid[], text[], text, timestamptz) from public, anon, authenticated;

-- 1 e 2: nasce uma ligação
create or replace function public.fn_iavek_ligacao_nasceu()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_k integer;
  v_kinds text[];
begin
  begin
    if new.lead_id is null then return null; end if;
    if new.source_kind = 'ligacao:quente' then
      perform public.fn_iavek_cancela_ligacoes(new.organization_id, array[new.lead_id],
        array['ligacao:L3','ligacao:L4','ligacao:L5','ligacao:L6','ligacao:L7'], 'cliente_respondeu', new.created_at);
    elsif new.source_kind ~ '^ligacao:L[2-7]$' then
      v_k := substring(new.source_kind from 'L([2-7])$')::integer;
      select array_agg('ligacao:L' || i) into v_kinds from generate_series(1, v_k - 1) i;
      perform public.fn_iavek_cancela_ligacoes(new.organization_id, array[new.lead_id], v_kinds, 'proxima_ligacao', new.created_at);
    end if;
  exception when others then
    raise warning 'fn_iavek_ligacao_nasceu (0640): % (tarefa %)', sqlerrm, new.id;
  end;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_ligacao_nasceu() from public, anon, authenticated;

drop trigger if exists trg_iavek_ligacao_nasceu on public.crm_tasks;
create trigger trg_iavek_ligacao_nasceu
  after insert on public.crm_tasks
  for each row
  when (new.source_kind like 'ligacao:%' and new.lead_id is not null)
  execute function public.fn_iavek_ligacao_nasceu();

-- 3: o lead entra numa etapa de compromisso
create or replace function public.fn_iavek_ligacoes_na_etapa_de_compromisso()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_etapas jsonb;
begin
  begin
    select o.settings -> 'esteira' -> 'entrada' -> 'etapas_de_compromisso' into v_etapas
      from public.organizations o where o.id = new.organization_id;
    if jsonb_typeof(v_etapas) = 'array'
       and v_etapas ? new.stage_id::text
       and not (old.stage_id is not null and v_etapas ? old.stage_id::text) then
      perform public.fn_iavek_cancela_ligacoes(new.organization_id, array[new.id],
        array['ligacao:L1','ligacao:L2','ligacao:L3','ligacao:L4','ligacao:L5','ligacao:L6','ligacao:L7',
              'ligacao:quente','ligacao:retorno','ligacao:retentativa'],
        'etapa_de_compromisso');
    end if;
  exception when others then
    raise warning 'fn_iavek_ligacoes_na_etapa_de_compromisso (0640): % (lead %)', sqlerrm, new.id;
  end;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_ligacoes_na_etapa_de_compromisso() from public, anon, authenticated;

drop trigger if exists trg_iavek_ligacoes_na_etapa_de_compromisso on public.crm_leads;
-- AFTER UPDATE com WHEN (e não "update of stage_id"), pela mesma razão da 0639: a etapa pode mudar por outro gatilho.
create trigger trg_iavek_ligacoes_na_etapa_de_compromisso
  after update on public.crm_leads
  for each row
  when (new.stage_id is distinct from old.stage_id and new.stage_id is not null)
  execute function public.fn_iavek_ligacoes_na_etapa_de_compromisso();

-- 4: uma pessoa da equipe responde
create or replace function public.fn_iavek_quente_fecha_com_resposta_de_gente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_leads uuid[];
begin
  begin
    if new.contact_id is null then return null; end if;
    select array_agg(l.id) into v_leads
      from public.crm_leads l
     where l.organization_id = new.organization_id and l.contact_id = new.contact_id;
    if v_leads is not null then
      perform public.fn_iavek_cancela_ligacoes(new.organization_id, v_leads, array['ligacao:quente'],
        'equipe_respondeu', coalesce(new.created_at, now()));
    end if;
  exception when others then
    raise warning 'fn_iavek_quente_fecha_com_resposta_de_gente (0640): % (mensagem %)', sqlerrm, new.id;
  end;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_quente_fecha_com_resposta_de_gente() from public, anon, authenticated;

drop trigger if exists trg_iavek_quente_fecha_com_resposta_de_gente on public.messages;
create trigger trg_iavek_quente_fecha_com_resposta_de_gente
  after insert on public.messages
  for each row
  when (new.direction = 'outbound' and new.sent_via::text = 'user' and new.sent_by_user_id is not null)
  execute function public.fn_iavek_quente_fecha_com_resposta_de_gente();

notify pgrst, 'reload schema';
