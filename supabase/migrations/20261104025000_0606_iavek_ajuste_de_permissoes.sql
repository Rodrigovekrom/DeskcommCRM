-- manifest: ia.vek v1.9.19 (0606) — ajuste de permissões por função: a troca de responsável da conversa respeita o alcance de quem pede, e o vendedor não move lead para a coluna da IA.
--
-- ADITIVA: 2 funções e 2 gatilhos. Nada é reescrito. As duas regras valem para uma PESSOA
-- (`auth.uid()`): worker e chave de serviço seguem como antes.

create or replace function public.fn_iavek_responsavel_no_alcance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.assigned_to_user_id is not distinct from old.assigned_to_user_id then
    return new;
  end if;
  if public.fn_is_platform_admin()
     or exists (select 1 from public.fn_iavek_visao_de_conversas() v
                 where v.org_id = old.organization_id
                   and (v.ve_tudo
                        or old.assigned_to_user_id = auth.uid()
                        or (old.assigned_to_user_id is null and v.ve_sem_dono)))
     or exists (select 1 from public.fn_iavek_contatos_que_guardo() g
                 where g.org_id = old.organization_id and g.contato_id = old.contact_id) then
    return new;
  end if;
  raise exception 'conversa_fora_do_alcance' using errcode = 'PT404';
end;
$$;
revoke execute on function public.fn_iavek_responsavel_no_alcance() from public, anon, authenticated;

drop trigger if exists trg_iavek_responsavel_no_alcance on public.conversations;
create trigger trg_iavek_responsavel_no_alcance
  before update of assigned_to_user_id on public.conversations
  for each row
  execute function public.fn_iavek_responsavel_no_alcance();

create or replace function public.fn_iavek_vendedor_fora_da_coluna_da_ia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if coalesce(public.fn_iavek_funcao_do_membro(new.organization_id, auth.uid()), '') = 'vendedor'
     and exists (select 1 from public.crm_stages s
                  where s.id = new.stage_id and lower(btrim(s.name)) = 'ia atendendo') then
    raise exception 'vendedor_fora_da_coluna_da_ia: o vendedor não move lead para a coluna da IA'
      using errcode = 'PT403';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_vendedor_fora_da_coluna_da_ia() from public, anon, authenticated;

drop trigger if exists trg_iavek_vendedor_fora_da_coluna_da_ia on public.crm_leads;
create trigger trg_iavek_vendedor_fora_da_coluna_da_ia
  before update of stage_id on public.crm_leads
  for each row
  execute function public.fn_iavek_vendedor_fora_da_coluna_da_ia();
