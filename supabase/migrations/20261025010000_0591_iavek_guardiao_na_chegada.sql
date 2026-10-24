-- manifest: ia.vek v1.8.3 — guardião na chegada: o lead que ganha dono com função SDR (rodízio, atribuição à mão ou criado já com dono) grava o SDR como guardião (sdr_user_id); a trava dos campos aceita como guardião o lead cujo dono atual é SDR
--
-- POR QUÊ (decisão do Rodrigo, 24/10/2026): todo lead que chega vai primeiro a
-- um SDR, que atende; depois passa ao vendedor. Até a v1.8.2 o guardião só
-- nascia na troca de dono SDR → outra pessoa (gatilho da 0579), e na produção
-- 0 de 386 leads tinham guardião. Com a trava ligada, o vendedor nunca
-- conseguia completar o lead (não há campo Guardião na ficha dele).
--
-- O QUE MUDA:
--   · fn_iavek_guardiao_na_troca_de_dono (BEFORE UPDATE OF owner_user_id): além
--     de guardar o SDR que ENTREGA o lead, grava o SDR que o RECEBE quando o
--     lead ainda não tem guardião. Cobre o rodízio (fn_iavek_rodizio_entregar é
--     um UPDATE do dono) e a atribuição à mão.
--   · gatilho novo BEFORE INSERT: lead criado já com dono SDR nasce com ele de
--     guardião. Só preenche quando sdr_user_id vem nulo (o clone que herda o
--     guardião, 0579, continua mandando).
--   · fn_iavek_campos_que_faltam_do_lead: "Guardião responsável" fica cumprido
--     também quando o DONO ATUAL tem função SDR — o lead que hoje está com o SDR
--     não precisa ser reescrito.
--
-- ADITIVA: nenhuma linha existente muda. Guardião já gravado nunca é trocado.
-- O que decide "é SDR" é a função na loja (user_organizations.interface_settings
-- ->>'funcao' = 'sdr', fn_iavek_funcao_do_membro), a mesma régua da 0579.

-- ---- 1. guardião na troca de dono: o SDR que entrega OU o SDR que recebe ----
create or replace function public.fn_iavek_guardiao_na_troca_de_dono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id
     and new.owner_user_id is not null
     and new.sdr_user_id is null
  then
    if old.owner_user_id is not null
       and coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, old.owner_user_id), '') = 'sdr'
    then
      new.sdr_user_id := old.owner_user_id;
    elsif coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, new.owner_user_id), '') = 'sdr' then
      new.sdr_user_id := new.owner_user_id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_guardiao_na_troca_de_dono() from public, anon, authenticated;

-- ---- 2. guardião na chegada: lead criado já com dono SDR ----
create or replace function public.fn_iavek_guardiao_na_chegada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sdr_user_id is null
     and new.owner_user_id is not null
     and coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, new.owner_user_id), '') = 'sdr'
  then
    new.sdr_user_id := new.owner_user_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_guardiao_na_chegada() from public, anon, authenticated;

drop trigger if exists trg_iavek_guardiao_na_chegada on public.crm_leads;
create trigger trg_iavek_guardiao_na_chegada
  before insert on public.crm_leads
  for each row execute function public.fn_iavek_guardiao_na_chegada();

-- ---- 3. a trava aceita o dono SDR como guardião ----
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
    case when l.sdr_user_id is not null
           or (l.owner_user_id is not null
               and coalesce(public.fn_iavek_funcao_do_membro(l.organization_id, l.owner_user_id), '') = 'sdr')
         then null else 'Guardião responsável' end,
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
grant execute on function public.fn_iavek_campos_que_faltam_do_lead(public.crm_leads) to authenticated, service_role;
