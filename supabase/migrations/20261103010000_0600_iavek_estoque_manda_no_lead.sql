-- manifest: ia.vek v1.9.12 (0600) — estoque no lead: o preço do Altimus manda no valor do lead ABERTO, o preço do estoque fica guardado na venda, e o aviso da loja (um por ciclo do carro no estoque) entra no sino de todos os membros, só com o carro
--
-- O PEDIDO (dono do produto, 02/11)
--   1. Lead ABERTO com carro do Altimus: o valor do lead é o preço do carro,
--      mesmo por cima de valor digitado. Lead fechado nunca muda.
--   2. Carro que sai do estoque: aviso a TODOS os membros ativos, uma vez, só
--      com o carro (nunca lead nem cliente: respeita a 0598).
--   3. Na venda, o preço do estoque fica guardado à parte, para comparar.
--
-- UM GATILHO, E NÃO UMA RODADA DO CRON: são muitos os caminhos que gravam o carro
-- ou o valor (ficha, passagem, arrasto, API); um só lugar não deixa nenhum de fora.
--
-- A LOJA: `origem = 'altimus'` só existe na organização dona do estoque; clínica
-- e demais empresas não têm produto com essa origem, e nada muda para elas.
--
-- O AVISO É GENÉRICO (`aviso_da_loja`, com `dados.evento`), e o carimbo
-- `aviso_da_loja_em` vale para QUALQUER evento do carro: o primeiro aviso de um
-- ciclo no estoque leva o carimbo, os seguintes não saem, e o carro que VOLTA ao
-- estoque começa um ciclo novo. Por isso um aviso futuro de "vendido" entra sem
-- retrabalho e sem um segundo aviso quando o carro depois sai do Altimus.
--
-- ADITIVA: 2 colunas, 2 funções de gatilho, 1 função de aviso e 1 tipo de aviso.
-- Dados: os leads abertos passam a ter o valor do carro (regra 1), e os carros que
-- JÁ estão fora do estoque ganham o carimbo, para não avisar o passado.

alter table public.catalog_products add column if not exists aviso_da_loja_em timestamptz;
alter table public.crm_leads add column if not exists preco_estoque_na_venda_cents bigint;

alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'lead_passado',
  'guardiao_etapa',
  'guardiao_ganho',
  'guardiao_perda',
  'guardiao_tarefa_vencida',
  'tarefa_vencida',
  'proposta_aguardando_aprovacao',
  'proposta_aprovada',
  'proposta_devolvida',
  'pedido_de_agendamento',
  'pedido_de_agendamento_confirmado',
  'pedido_de_agendamento_recusado',
  'ficha_enviada',
  'ficha_decidida',
  'agendamento_para_voce',
  'lead_devolvido',
  'lead_retirado',
  'lead_reativado',
  -- ia.vek v1.9.12 (migration 0600): aviso a toda a loja, sem dado de lead.
  'aviso_da_loja'
));

-- O valor do lead aberto e o preço guardado na venda. Roda DEPOIS de
-- `trg_crm_lead_close_on_stage` (ordem alfabética): já vê o status final da escrita.
create or replace function public.fn_iavek_valor_do_carro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_carro text := new.custom_fields->>'carro_interesse';
  v_preco bigint;
begin
  if new.status = 'open' then
    new.preco_estoque_na_venda_cents := null;
  end if;
  if v_carro is null
     or v_carro !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  select p.preco_cents into v_preco
    from public.catalog_products p
   where p.id = v_carro::uuid
     and p.organization_id = new.organization_id
     and p.origem = 'altimus';
  -- Carro sem preço (em preparação) não zera o valor do lead.
  if coalesce(v_preco, 0) <= 0 then
    return new;
  end if;
  if new.status = 'open' then
    new.value_cents := v_preco;
  elsif new.status = 'won' and (tg_op = 'INSERT' or old.status is distinct from 'won') then
    new.preco_estoque_na_venda_cents := v_preco;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_valor_do_carro() from public, anon, authenticated;

drop trigger if exists trg_zz_iavek_valor_do_carro on public.crm_leads;
create trigger trg_zz_iavek_valor_do_carro
  before insert or update of custom_fields, value_cents, stage_id on public.crm_leads
  for each row execute function public.fn_iavek_valor_do_carro();

-- O preço mudou no Altimus: os leads ABERTOS daquele carro acompanham.
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
     and l.status = 'open'
     and l.custom_fields->>'carro_interesse' = new.id::text
     and l.value_cents is distinct from new.preco_cents;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_preco_do_carro_mudou() from public, anon, authenticated;

drop trigger if exists trg_iavek_preco_do_carro_mudou on public.catalog_products;
create trigger trg_iavek_preco_do_carro_mudou
  after update of preco_cents on public.catalog_products
  for each row
  when (new.origem = 'altimus' and new.preco_cents > 0 and new.preco_cents is distinct from old.preco_cents)
  execute function public.fn_iavek_preco_do_carro_mudou();

-- O carro que VOLTA ao estoque começa um ciclo novo: pode avisar de novo.
create or replace function public.fn_iavek_carro_voltou()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.aviso_da_loja_em := null;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_carro_voltou() from public, anon, authenticated;

drop trigger if exists trg_iavek_carro_voltou on public.catalog_products;
create trigger trg_iavek_carro_voltou
  before update of ativo on public.catalog_products
  for each row
  when (old.ativo = false and new.ativo = true)
  execute function public.fn_iavek_carro_voltou();

-- O aviso da loja: UM por ciclo do carro (quem leva o carimbo avisa), para os
-- membros ativos, só com o nome do carro. Devolve quantas pessoas foram avisadas.
create or replace function public.fn_iavek_aviso_da_loja(
  p_org uuid,
  p_evento text,
  p_carro uuid,
  p_ator uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text;
  v_avisados integer;
begin
  update public.catalog_products
     set aviso_da_loja_em = now()
   where id = p_carro
     and organization_id = p_org
     and aviso_da_loja_em is null
  returning nome into v_nome;
  if not found then
    return 0;
  end if;
  insert into public.notificacoes (organization_id, user_id, tipo, ator_user_id, dados)
  select p_org, uo.user_id, 'aviso_da_loja', p_ator,
         jsonb_build_object('evento', p_evento, 'carro_id', p_carro, 'carro_nome', v_nome)
    from public.user_organizations uo
   where uo.organization_id = p_org
     and uo.revoked_at is null
     and uo.accepted_at is not null;
  get diagnostics v_avisados = row_count;
  return v_avisados;
end;
$$;
revoke execute on function public.fn_iavek_aviso_da_loja(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_aviso_da_loja(uuid, text, uuid, uuid) to service_role;

-- O que já está fora do estoque não vira aviso: só o que sair daqui em diante.
update public.catalog_products
   set aviso_da_loja_em = now()
 where origem = 'altimus'
   and ativo = false
   and aviso_da_loja_em is null;

-- Os leads abertos que já têm carro passam a ter o valor do carro (regra 1).
update public.crm_leads l
   set value_cents = p.preco_cents
  from public.catalog_products p
 where p.id::text = l.custom_fields->>'carro_interesse'
   and p.organization_id = l.organization_id
   and p.origem = 'altimus'
   and p.preco_cents > 0
   and l.status = 'open'
   and l.value_cents is distinct from p.preco_cents;
