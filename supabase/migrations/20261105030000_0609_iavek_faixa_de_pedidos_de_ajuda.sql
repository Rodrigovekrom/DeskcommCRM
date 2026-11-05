-- manifest: ia.vek v1.9.21 (0609) — faixa do Guardião Leads: quem está em Suporte IA sem dono aparece ao guardião, que vê só o nome e pode assumir
--
-- ADITIVA: 2 funções. Nenhuma regra de acesso muda, nenhuma linha é reescrita.
--
-- Com `guardiao_ve_sem_dono = false`, o guardião não enxerga lead sem dono: a RLS responde
-- vazio e o "Assumir" comum não acha o lead. A faixa é a exceção estreita que o Rodrigo
-- escolheu: só o lead na etapa Suporte IA, aberto, sem pessoa e sem agente. Por isso duas
-- funções `security definer` que conferem a função da pessoa, e não uma folga na RLS.
create or replace function public.fn_iavek_faixa_de_ajuda(p_org uuid)
returns table (lead_id uuid, titulo text, cliente text, desde timestamptz, total bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id,
         l.title,
         coalesce(nullif(c.display_name, ''), nullif(c.name, '')),
         l.updated_at,
         count(*) over ()
    from public.crm_leads l
    join public.crm_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
    left join public.contacts c on c.id = l.contact_id and c.organization_id = l.organization_id
   where l.organization_id = p_org
     and public.fn_iavek_funcao_na_org(p_org) = 'sdr'
     and s.slug = 'em-atendimento-ia'
     and l.status = 'open'
     and l.owner_user_id is null
     and l.owner_agent_id is null
   order by l.updated_at asc, l.id
   limit 20;
$$;
revoke execute on function public.fn_iavek_faixa_de_ajuda(uuid) from public, anon;
grant execute on function public.fn_iavek_faixa_de_ajuda(uuid) to authenticated, service_role;

create or replace function public.fn_iavek_assumir_da_faixa(p_lead uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_eu uuid := auth.uid();
  v_lead public.crm_leads%rowtype;
  v_slug text;
  v_conversa uuid;
  v_dono_da_conversa uuid;
begin
  if v_eu is null then
    raise exception 'faixa_so_guardiao: só o guardião assume por aqui' using errcode = '42501';
  end if;
  select * into v_lead from public.crm_leads where id = p_lead for update;
  if not found or coalesce(public.fn_iavek_funcao_na_org(v_lead.organization_id), '') <> 'sdr' then
    raise exception 'faixa_so_guardiao: só o guardião assume por aqui' using errcode = '42501';
  end if;
  if not public.fn_support_write_allowed(v_lead.organization_id) then
    raise exception 'support_readonly' using errcode = '42501';
  end if;
  select s.slug into v_slug from public.crm_stages s where s.id = v_lead.stage_id;
  if v_lead.status <> 'open' or v_lead.owner_user_id is not null or v_lead.owner_agent_id is not null
     or v_slug is distinct from 'em-atendimento-ia' then
    raise exception 'faixa_ja_entregue: este lead já foi entregue' using errcode = 'PT409';
  end if;

  select c.id, c.assigned_to_user_id into v_conversa, v_dono_da_conversa
    from public.conversations c
   where c.organization_id = v_lead.organization_id
     and c.contact_id = v_lead.contact_id
     and c.is_group = false
     and c.status <> 'archived'
   order by c.last_message_at desc nulls last
   limit 1;
  if v_dono_da_conversa is not null and v_dono_da_conversa <> v_eu then
    raise exception 'faixa_conversa_de_outro: a conversa deste cliente já é de outra pessoa' using errcode = 'PT409';
  end if;
  -- O lead primeiro: com ele na mão, a guarda de responsável (0606) já reconhece a conversa como
  -- dele. Na ordem inversa ela recusa, porque com o recorte ligado a conversa sem dono está fora do alcance.
  update public.crm_leads
     set owner_user_id = v_eu, owner_agent_id = null, owner_kind = 'user', assigned_at = now()
   where id = p_lead
     and owner_user_id is null;
  if v_conversa is not null and v_dono_da_conversa is null then
    perform * from public.fn_conversation_assign(v_lead.organization_id, v_conversa, v_eu, 'claim', null, true);
  end if;
  return v_conversa;
end;
$$;
revoke execute on function public.fn_iavek_assumir_da_faixa(uuid) from public, anon;
grant execute on function public.fn_iavek_assumir_da_faixa(uuid) to authenticated, service_role;
