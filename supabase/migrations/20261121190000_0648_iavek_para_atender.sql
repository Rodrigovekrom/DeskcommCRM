-- manifest: ia.vek v1.9.62 (0648, CRM-535) — o lead que vira de um VENDEDOR vai para a coluna de entrada dele (crm_pipelines.settings.etapa_de_entrada_do_vendedor), por gatilho, em todo caminho; com a linha do tempo e o lead.stage_changed
--
-- POR QUÊ (Rodrigo 17/11, CRM-535 opção B; D1=C "535 e 497 juntos na 62"): o lead passado a um vendedor ficava na etapa
-- de antes (ex.: 'IA Atendendo', que o vendedor NÃO vê: medido em 17/11, 31 leads da Paloma sumiram da tela deles). Cada
-- caminho que troca o dono (a passagem, o agendamento, o quadro, o rodízio, roteiros) teria de lembrar de mover. O
-- gatilho fecha isso para TODOS os caminhos.
-- O QUE MUDA (vale para toda org, mas SÓ age onde a config existe; nenhuma org fixa):
--  1. BEFORE INSERT OR UPDATE OF owner_user_id em crm_leads (o nome ordena ANTES de trg_stamp_stage_changed_at, que
--     então carimba a hora da etapa nova): quando o DONO muda para um membro com função 'vendedor', o lead está aberto,
--     o funil dele tem settings.etapa_de_entrada_do_vendedor (um slug de etapa ativa do MESMO funil) e a etapa atual
--     está ANTES dela (posição menor), o lead vai para essa etapa. NÃO age quando a mesma escrita já escolhe a etapa
--     (stage_id muda junto), nem com o sinal administrativo (0647), nem para dono que não é vendedor;
--  2. AFTER do mesmo par: grava a linha do tempo (stage_changed, ator 'rule') e o evento lead.stage_changed (o mesmo
--     formato do move da tela, sem service_origin), para as métricas, o follow-up por etapa e as automações enxergarem.
--     O BEFORE passa ao AFTER a etapa de antes por um set_config LOCAL à transação (iavek.pa_<id do lead>).
-- A COLUNA em si (a etapa 'Para atender' e a chave no funil) é DADO da loja: fenomenos/criar-coluna-entrada-vendedor.sh.
-- Sem a chave no funil, nada muda. ADITIVA (2 funções e 2 gatilhos novos; nenhuma tabela, policy ou função existente).
-- Volta: voltar-0648.sql (drop dos 2 gatilhos e das 2 funções).

create or replace function public.fn_iavek_para_atender_na_troca_de_dono()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_destino uuid;
  v_pos_destino numeric;
  v_pos_atual numeric;
begin
  if new.owner_user_id is null or new.status is distinct from 'open' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.owner_user_id is not distinct from old.owner_user_id then return new; end if;
    -- a mesma escrita já escolhe a etapa (a passagem que move junto): ela manda
    if new.stage_id is distinct from old.stage_id then return new; end if;
  end if;
  if coalesce(current_setting('iavek.mudanca_administrativa', true), '') = 'sim' then
    return new;
  end if;
  if coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, new.owner_user_id), '') <> 'vendedor' then
    return new;
  end if;
  select nullif(btrim(p.settings->>'etapa_de_entrada_do_vendedor'), '') into v_slug
    from public.crm_pipelines p
   where p.id = new.pipeline_id and p.organization_id = new.organization_id;
  if v_slug is null then
    return new;
  end if;
  select s.id, s.position into v_destino, v_pos_destino
    from public.crm_stages s
   where s.pipeline_id = new.pipeline_id and s.organization_id = new.organization_id
     and s.slug = v_slug and not s.is_archived and not s.is_won and not s.is_lost
   limit 1;
  if v_destino is null or v_destino = new.stage_id then
    return new;
  end if;
  select s.position into v_pos_atual from public.crm_stages s where s.id = new.stage_id;
  -- só PARA A FRENTE: o lead que já está numa etapa depois da coluna (ou na própria) fica onde está
  if v_pos_atual is null or v_pos_atual >= v_pos_destino then
    return new;
  end if;
  perform set_config('iavek.pa_' || replace(new.id::text, '-', ''), new.stage_id::text, true);
  new.stage_id := v_destino;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_para_atender_na_troca_de_dono() from public, anon, authenticated;

create or replace function public.fn_iavek_para_atender_registra()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chave text := 'iavek.pa_' || replace(new.id::text, '-', '');
  v_de text := nullif(current_setting(v_chave, true), '');
begin
  if v_de is null then
    return null;
  end if;
  perform set_config(v_chave, '', true);
  insert into public.crm_lead_activities
    (organization_id, lead_id, contact_id, source_module, source_id, type, actor_kind, reason, payload, metadata, performed_at)
  values (new.organization_id, new.id, new.contact_id, 'crm', new.id, 'stage_changed', 'rule',
          'Passou a um vendedor: foi para a coluna de entrada dele',
          jsonb_build_object('from_stage_id', v_de, 'to_stage_id', new.stage_id, 'pipeline_id', new.pipeline_id, 'para_atender', true),
          jsonb_build_object('origem', 'gatilho_0648'), now());
  perform public.emit_event(
    'lead.stage_changed', 'crm_lead', new.id,
    jsonb_build_object('pipeline_id', new.pipeline_id, 'from_stage_id', v_de, 'to_stage_id', new.stage_id,
                       'status', new.status, 'para_atender', true),
    jsonb_build_object('origem', 'gatilho_0648'),
    new.organization_id);
  return null;
end;
$$;
revoke execute on function public.fn_iavek_para_atender_registra() from public, anon, authenticated;

drop trigger if exists trg_iavek_para_atender_na_troca_de_dono on public.crm_leads;
create trigger trg_iavek_para_atender_na_troca_de_dono
  before insert or update of owner_user_id on public.crm_leads
  for each row execute function public.fn_iavek_para_atender_na_troca_de_dono();

drop trigger if exists trg_iavek_para_atender_registra on public.crm_leads;
create trigger trg_iavek_para_atender_registra
  after insert or update of owner_user_id on public.crm_leads
  for each row execute function public.fn_iavek_para_atender_registra();
