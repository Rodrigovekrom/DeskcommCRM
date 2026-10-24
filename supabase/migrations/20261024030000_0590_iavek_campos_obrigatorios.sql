-- manifest: ia.vek v1.8.2 — campos obrigatórios do lead: campo "Parcela desejável" no funil 72h, função que diz o que falta (7 campos) e trava ao MOVER para Agendamento / Ligação de vídeo feita / Lead qualificado / Troca / Vendido quando a loja liga "Exigir campos obrigatórios" (desligado por padrão)
--
-- POR QUÊ (pedido do Rodrigo, 24/10/2026; proposta do Maestro): todo lead tem
-- de chegar à etapa de compromisso com contexto, tags, fase, guardião, vendedor,
-- carro de interesse e parcela desejável. A ENTRADA do lead não trava (ele chega
-- sozinho do Meta e da IA): só o MOVER, por uma pessoa, para as etapas de
-- compromisso.
--
-- O QUE FALTA (fn_iavek_campos_que_faltam), na ordem da tela:
--   Contexto completo      ao menos 1 nota interna numa conversa do contato
--                          (conversation_notes) ou 1 nota da IA (lead_notes)
--   Tags de acompanhamento ao menos 1 tag no lead ou no contato
--   Fase do funil          a etapa (sempre preenchida)
--   Guardião responsável   crm_leads.sdr_user_id
--   Vendedor responsável   crm_leads.owner_user_id
--   Carro de interesse     custom_fields.carro_interesse
--   Parcela desejável      custom_fields.parcela_desejavel > 0
--
-- A TRAVA só olha SESSÃO de pessoa (auth.uid() não nulo) e só com o interruptor
-- `organizations.settings.iavek.campos_obrigatorios.ativo = true` (admin liga em
-- Configurações; padrão desligado). IA, automações, crons e workers seguem.
-- ADITIVA: um campo no funil 72h (só se faltar), funções e um gatilho novos.

-- ---- 1. o campo "Parcela desejável" no funil 72h (e no follow-up), se faltar ----
update public.crm_pipelines p
   set settings = jsonb_set(
         coalesce(p.settings, '{}'::jsonb), '{fields}',
         coalesce(p.settings->'fields', '[]'::jsonb)
           || jsonb_build_array(jsonb_build_object('key', 'parcela_desejavel', 'type', 'number', 'label', 'Parcela desejável (R$)')))
 where p.slug in ('fenomenos-72h', 'fenomenos-follow-up')
   and not exists (select 1 from jsonb_array_elements(coalesce(p.settings->'fields', '[]'::jsonb)) f where f->>'key' = 'parcela_desejavel');

-- ---- 2. o que falta num lead ----
create or replace function public.fn_iavek_campos_que_faltam_do_lead(l public.crm_leads)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when exists (select 1 from public.conversation_notes n join public.conversations c on c.id = n.conversation_id
                       where c.contact_id = l.contact_id and c.organization_id = l.organization_id)
           or exists (select 1 from public.lead_notes ln where ln.contact_id = l.contact_id and ln.organization_id = l.organization_id)
         then null else 'Contexto completo' end,
    case when coalesce(array_length(l.tags, 1), 0) > 0
           or exists (select 1 from public.contacts k where k.id = l.contact_id and coalesce(array_length(k.tags, 1), 0) > 0)
         then null else 'Tags de acompanhamento' end,
    case when l.stage_id is not null then null else 'Fase do funil' end,
    case when l.sdr_user_id is not null then null else 'Guardião responsável' end,
    case when l.owner_user_id is not null then null else 'Vendedor responsável' end,
    case when nullif(btrim(coalesce(l.custom_fields->>'carro_interesse', '')), '') is not null then null else 'Carro de interesse' end,
    case when coalesce(l.custom_fields->>'parcela_desejavel', '') ~ '^\s*[0-9]+([.,][0-9]+)?\s*$'
              and replace(l.custom_fields->>'parcela_desejavel', ',', '.')::numeric > 0
         then null else 'Parcela desejável' end
  ], null)
  -- Só responde por lead da organização de quem pergunta (sessão); o serviço vê todos.
  where auth.uid() is null or l.organization_id in (select public.fn_user_org_ids());
$$;
revoke execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) from public, anon;
-- `authenticated` porque a TRAVA roda com a sessão de quem move.
grant execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) to authenticated, service_role;

-- Em lote, para o cartão e a barra (só os leads que quem pergunta enxerga).
create or replace function public.fn_iavek_campos_que_faltam(p_lead_ids uuid[])
returns table (lead_id uuid, faltam text[])
language sql
stable
security definer
set search_path = public
as $$
  select l.id, public.fn_iavek_campos_que_faltam_do_lead(l)
    from public.crm_leads l
   where l.id = any(p_lead_ids)
     and (auth.uid() is null or l.organization_id in (select public.fn_user_org_ids()));
$$;
revoke execute on function public.fn_iavek_campos_que_faltam(uuid[]) from public, anon;
grant execute on function public.fn_iavek_campos_que_faltam(uuid[]) to authenticated, service_role;

-- ---- 3. a trava ao MOVER ----
create or replace function public.fn_iavek_campos_obrigatorios_ao_mover()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_faltam text[];
begin
  if auth.uid() is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = new.organization_id
                    and coalesce((o.settings->'iavek'->'campos_obrigatorios'->>'ativo')::boolean, false)) then
    return new;
  end if;
  if not exists (select 1 from public.crm_stages s
                  where s.id = new.stage_id
                    and s.slug in ('agendado-video', 'ligacao-de-video', 'qualificado', 'troca', 'vendido')) then
    return new;
  end if;
  v_faltam := public.fn_iavek_campos_que_faltam_do_lead(new);
  if coalesce(array_length(v_faltam, 1), 0) > 0 then
    raise exception 'Faltam campos obrigatórios: %', array_to_string(v_faltam, ', ')
      using errcode = 'PT422';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_campos_obrigatorios_ao_mover() from public, anon;
grant execute on function public.fn_iavek_campos_obrigatorios_ao_mover() to authenticated, service_role;

drop trigger if exists trg_iavek_campos_obrigatorios_ao_mover on public.crm_leads;
create trigger trg_iavek_campos_obrigatorios_ao_mover
  before update of stage_id on public.crm_leads
  for each row execute function public.fn_iavek_campos_obrigatorios_ao_mover();
