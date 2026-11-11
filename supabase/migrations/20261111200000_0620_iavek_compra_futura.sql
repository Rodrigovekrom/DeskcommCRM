-- manifest: ia.vek v1.9.45 (0620, CRM-294) — Compra futura: o lead ganha o status 'future' (não é Perdido nem aberto), com o mês/ano previsto OPCIONAL (Rodrigo, 11/11; obrigatório só com o interruptor mes_obrigatorio); a etapa marcada is_compra_futura dá o status, e sair dela reabre
--
-- POR QUÊ: o Rodrigo (11/11): "uma nova categoria, além do perdido, para compras futuras... eles não são
-- perdidos". Aprovado com as 2 recomendações (o mês obrigatório e o mesmo vendedor); SIMPLIFICADO pelo Rodrigo em 11/11
-- (19:48Z): "só o lead organizado naquela coluna do Kanban; é só para visão". O mês passou a OPCIONAL, e a tarefa dos 7
-- dias, a faixa da vencida e os avisos ficaram atrás de interruptores DESLIGADOS. O mesmo vendedor
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
--     fn_iavek_compra_futura_ligada para lê-los; as decisões (a) (fn_nascer_lead_da_conversa acorda o lead
--     futuro) e (b) (fn_iavek_preco_do_carro_mudou vale para o future) ficam prontas atrás deles.
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
    -- o mês só existe no lead em Compra futura; e é OPCIONAL (Rodrigo, 11/11: "é só para visão e organizar")
    (compra_futura_mes is null or status = 'future')
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
    -- ia.vek 0620 (CRM-294): Compra futura. O mês é OPCIONAL (Rodrigo, 11/11); só é exigido se a empresa ligar o
    -- interruptor settings.iavek.compra_futura.mes_obrigatorio. Se vier, não pode estar no passado.
    if new.compra_futura_mes is null and public.fn_iavek_compra_futura_ligada(new.organization_id, 'mes_obrigatorio') then
      raise exception 'compra_futura_mes_required' using errcode = '23514',
        hint = 'Informe o mês e o ano previstos da compra.';
    end if;
    new.compra_futura_mes := date_trunc('month', new.compra_futura_mes)::date;
    if new.compra_futura_mes is not null
       and new.compra_futura_mes < date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date
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

-- 5. Os interruptores (todos DESLIGADOS de fábrica). Rodrigo, 11/11: a Compra futura é "só o lead organizado naquela
--    coluna do Kanban; não precisa avisar nem informar valor". Por isso, desligados: acorda_com_mensagem,
--    aviso_de_preco, avisar_guardiao, ligacao_7_dias (a tarefa 7 dias antes), faixa_vencida (a visão do gerente) e
--    mes_obrigatorio (o mês é opcional).
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

-- 6. As decisões (a) e (b) do Rodrigo, prontas e DESLIGADAS (cada uma pelo seu interruptor)
-- (b) aviso_de_preco: o preço do carro de interesse que muda vale também para o lead em Compra futura.
create or replace function public.fn_iavek_preco_do_carro_mudou()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.crm_leads l
     set value_cents = new.preco_cents
   where l.organization_id = new.organization_id
     and (l.status = 'open'
          or (l.status = 'future' and public.fn_iavek_compra_futura_ligada(l.organization_id, 'aviso_de_preco')))
     and l.custom_fields->>'carro_interesse' = new.id::text
     and l.value_cents is distinct from new.preco_cents;
  return null;
end;
$$;

-- (a) acorda_com_mensagem: o cliente em Compra futura que volta a escrever ACORDA o lead dele (volta à 1ª
-- etapa aberta do funil, com o MESMO dono; o gatilho reabre). Não nasce lead novo no ciclo de 72h.
create or replace function public.fn_nascer_lead_da_conversa(
  p_org uuid,
  p_contact uuid,
  p_pipeline uuid,
  p_stage uuid,
  p_title text,
  p_source text,
  p_source_metadata jsonb default '{}'::jsonb,
  p_tags text[] default '{}'::text[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_futuro record;
  v_etapa uuid;
begin
  -- Serializa por (organização, contato). Transaction-scoped: liberado no
  -- commit, sem risco de lock vazado.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_contact::text, 0));

  -- ia.vek 0620 (CRM-294, decisão (a), desligada até o ok do Rodrigo): acorda o lead em Compra futura.
  if public.fn_iavek_compra_futura_ligada(p_org, 'acorda_com_mensagem') then
    select id, pipeline_id into v_futuro
      from public.crm_leads
     where organization_id = p_org and contact_id = p_contact and status = 'future'
     order by updated_at desc
     limit 1;
    if v_futuro.id is not null then
      select s.id into v_etapa
        from public.crm_stages s
       where s.pipeline_id = v_futuro.pipeline_id
         and not s.is_won and not s.is_lost and not s.is_compra_futura and not s.is_archived
       order by s.position asc
       limit 1;
      if v_etapa is not null then
        update public.crm_leads set stage_id = v_etapa, updated_at = now()
         where id = v_futuro.id and organization_id = p_org;
      end if;
    end if;
  end if;

  select id into v_id
    from public.crm_leads
   where organization_id = p_org
     and contact_id = p_contact
     and status = 'open'
   limit 1;

  -- NULL significa "já existe", e quem chama traduz isso para `ja_existe`. Não é
  -- erro: é o desfecho correto da segunda mensagem.
  if v_id is not null then
    return null;
  end if;

  -- A moeda é a da organização. Sem ela o negócio pegava o default da coluna
  -- ('BRL') em QUALQUER organização, e o valor que o assistente grava depois
  -- saía para a plataforma de anúncio como real: ₲125.000 viravam R$ 125.000.
  insert into public.crm_leads
    (organization_id, pipeline_id, stage_id, contact_id, title, source, source_metadata, tags, currency)
  values
    (p_org, p_pipeline, p_stage, p_contact, p_title, p_source, coalesce(p_source_metadata, '{}'::jsonb), coalesce(p_tags, '{}'::text[]),
     coalesce((select o.currency from public.organizations o where o.id = p_org), 'BRL'))
  returning id into v_id;

  return v_id;
end;
$$;
grant execute on function public.fn_nascer_lead_da_conversa(uuid, uuid, uuid, uuid, text, text, jsonb, text[]) to authenticated, service_role;

notify pgrst, 'reload schema';
