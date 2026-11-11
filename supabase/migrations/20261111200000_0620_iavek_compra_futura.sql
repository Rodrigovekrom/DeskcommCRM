-- manifest: ia.vek v1.9.45 (0620, CRM-294) — Compra futura: o lead ganha o status 'future' (não é Perdido nem aberto), com o mês/ano previsto obrigatório; a etapa marcada is_compra_futura dá o status, e sair dela reabre
--
-- POR QUÊ: o Rodrigo (11/11): "uma nova categoria, além do perdido, para compras futuras... eles não são
-- perdidos". Aprovado com as 2 recomendações: o mês e o ano previstos são OBRIGATÓRIOS, e o mesmo vendedor
-- liga 7 dias antes (ou o guardião, se ele saiu da loja). A esteira não cobra nem move, e nunca conta como
-- Perdido. Desenho B (status novo), com o ok do Maestro e a revisão da Lupa; o impacto, lugar por lugar,
-- está em docs/iavek/compra-futura-impacto.md, e a divergência do upstream em docs/iavek/divergencias-do-upstream.md.
--
-- O QUE MUDA:
--   · crm_stages.is_compra_futura (default false; nunca junto com is_won/is_lost);
--   · crm_leads.compra_futura_mes (o 1º dia do mês previsto), compra_futura_vendedor_id (quem atendia ao
--     entrar) e compra_futura_tarefa_em (a marca da tarefa dos 7 dias, que impede repetir);
--   · os CHECKs crm_leads_status_enum (+ 'future') e crm_leads_closed_at_consistency ('future' ⇒ closed_at
--     NULO e o mês preenchido), mais o do mês no 1º dia e só no 'future';
--   · fn_crm_lead_close_on_stage (o ÚNICO escritor do status): etapa is_compra_futura ⇒ 'future' (exige o
--     mês; mês no passado é recusado); sair de 'future' para uma etapa comum REABRE (open) e limpa os campos;
--   · settings.iavek.compra_futura: 3 interruptores DESLIGADOS (decisões do Rodrigo em aberto) e a função
--     fn_iavek_compra_futura_ligada para lê-los.
-- ADITIVA: nenhuma linha existente muda (nenhuma etapa é is_compra_futura; nenhum lead é 'future').
-- Idempotente. Volta: voltar-0620.sql.

-- 1. A etapa
alter table public.crm_stages add column if not exists is_compra_futura boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_stages_compra_futura_nao_fecha'
                   and conrelid = 'public.crm_stages'::regclass) then
    alter table public.crm_stages
      add constraint crm_stages_compra_futura_nao_fecha check (not (is_compra_futura and (is_won or is_lost)));
  end if;
end
$$;
comment on column public.crm_stages.is_compra_futura is
  'ia.vek v1.9.45 (CRM-294): a etapa "Compra futura". O lead nela tem status ''future'' (não é ganho, perdido nem aberto).';

-- 2. O lead
alter table public.crm_leads add column if not exists compra_futura_mes date;
alter table public.crm_leads add column if not exists compra_futura_vendedor_id uuid;
alter table public.crm_leads add column if not exists compra_futura_tarefa_em timestamptz;
comment on column public.crm_leads.compra_futura_mes is
  'ia.vek v1.9.45 (CRM-294): o mês previsto da compra (sempre o dia 1). Obrigatório no status ''future'' e só nele.';
comment on column public.crm_leads.compra_futura_vendedor_id is
  'ia.vek v1.9.45 (CRM-294): quem atendia quando o lead foi para Compra futura; recebe a ligação 7 dias antes do mês.';
comment on column public.crm_leads.compra_futura_tarefa_em is
  'ia.vek v1.9.45 (CRM-294): quando a tarefa de ligação dos 7 dias foi criada (impede criar de novo).';

-- 3. Os CHECKs (o status é TEXTO com CHECK; não há tipo enum)
alter table public.crm_leads drop constraint if exists crm_leads_status_enum;
alter table public.crm_leads add constraint crm_leads_status_enum
  check (status = any (array['open'::text, 'won'::text, 'lost'::text, 'future'::text]));
alter table public.crm_leads drop constraint if exists crm_leads_closed_at_consistency;
alter table public.crm_leads add constraint crm_leads_closed_at_consistency
  check (
    (status = 'open' and closed_at is null)
    or (status = 'future' and closed_at is null)
    or (status = any (array['won'::text, 'lost'::text]) and closed_at is not null)
  );
alter table public.crm_leads drop constraint if exists crm_leads_compra_futura_mes_coerente;
alter table public.crm_leads add constraint crm_leads_compra_futura_mes_coerente
  check (
    (status = 'future') = (compra_futura_mes is not null)
    and (compra_futura_mes is null or extract(day from compra_futura_mes) = 1)
  );

-- 4. O gatilho que escreve o status (o corpo é o do dump, com o ramo da Compra futura e o reabrir a partir de 'future')
create or replace function public.fn_crm_lead_close_on_stage()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_is_won  boolean;
  v_is_lost boolean;
  v_is_futura boolean;
begin
  if tg_op = 'UPDATE'
     and new.stage_id is not distinct from old.stage_id
     and new.status   is not distinct from old.status
     and new.compra_futura_mes is not distinct from old.compra_futura_mes then
    return new;
  end if;

  select is_won, is_lost, is_compra_futura into v_is_won, v_is_lost, v_is_futura
    from public.crm_stages where id = new.stage_id;

  if v_is_won then
    new.status := 'won';
    new.closed_at := coalesce(new.closed_at, now());
    new.compra_futura_mes := null; new.compra_futura_vendedor_id := null; new.compra_futura_tarefa_em := null;
  elsif v_is_lost then
    new.status := 'lost';
    new.closed_at := coalesce(new.closed_at, now());
    new.compra_futura_mes := null; new.compra_futura_vendedor_id := null; new.compra_futura_tarefa_em := null;
    -- #1537: DE QUEM ERA a etapa que este negócio deixou (ver o corpo original).
    if tg_op = 'UPDATE' and old.status is distinct from 'lost' then
      new.lost_from_stage_id := coalesce(new.lost_from_stage_id, old.stage_id);
    end if;
  elsif v_is_futura then
    -- ia.vek 0620 (CRM-294): Compra futura. O mês é OBRIGATÓRIO e não pode estar no passado.
    if new.compra_futura_mes is null then
      raise exception 'compra_futura_mes_required' using errcode = '23514',
        hint = 'Informe o mês e o ano previstos da compra.';
    end if;
    new.compra_futura_mes := date_trunc('month', new.compra_futura_mes)::date;
    if new.compra_futura_mes < date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
       and (tg_op = 'INSERT' or old.compra_futura_mes is distinct from new.compra_futura_mes or old.status is distinct from 'future') then
      raise exception 'compra_futura_mes_no_passado' using errcode = '23514',
        hint = 'O mês previsto não pode estar no passado.';
    end if;
    new.status := 'future';
    new.closed_at := null;
    new.lost_from_stage_id := null;
    if tg_op = 'INSERT' or old.status is distinct from 'future' then
      new.compra_futura_vendedor_id := coalesce(new.compra_futura_vendedor_id, new.owner_user_id);
      new.compra_futura_tarefa_em := null;
    elsif old.compra_futura_mes is distinct from new.compra_futura_mes then
      new.compra_futura_tarefa_em := null;  -- mudou o mês: a tarefa dos 7 dias volta a valer
    end if;
  else
    -- reabre de won, lost E (ia.vek 0620) de future
    if tg_op = 'UPDATE' and old.status in ('won','lost','future') then
      new.status := 'open';
      new.closed_at := null;
      new.lost_from_stage_id := null;
    end if;
    new.compra_futura_mes := null; new.compra_futura_vendedor_id := null; new.compra_futura_tarefa_em := null;
  end if;
  return new;
end$$;

-- o gatilho passa a escutar também a troca do mês (remarcar o mês sem trocar de etapa)
drop trigger if exists trg_crm_lead_close_on_stage on public.crm_leads;
create trigger trg_crm_lead_close_on_stage
  before insert or update of stage_id, compra_futura_mes on public.crm_leads
  for each row execute function public.fn_crm_lead_close_on_stage();

-- 5. Os interruptores das 3 decisões do Rodrigo (todos DESLIGADOS até o ok)
create or replace function public.fn_iavek_compra_futura_ligada(p_org uuid, p_chave text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((settings -> 'iavek' -> 'compra_futura' ->> p_chave)::boolean, false)
    from public.organizations where id = p_org;
$$;
revoke all on function public.fn_iavek_compra_futura_ligada(uuid, text) from public, anon;
grant execute on function public.fn_iavek_compra_futura_ligada(uuid, text) to authenticated, service_role;
comment on function public.fn_iavek_compra_futura_ligada(uuid, text) is
  'ia.vek v1.9.45 (CRM-294): lê settings.iavek.compra_futura.<chave> (acorda_com_mensagem, aviso_de_preco, avisar_guardiao). Ausente = desligado.';

notify pgrst, 'reload schema';
