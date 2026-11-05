-- manifest: ia.vek v1.9.22 (0610) — Guardião Leads: o aviso do Venda.IA no grupo move o lead para Suporte IA e entrega ao próximo guardião
--
-- ADITIVA: 1 função e um valor a mais aceito em iavek_rodizio_registros.origem. Nenhuma linha é
-- reescrita, nenhuma regra de acesso muda. Nada liga grupo: sem `settings.iavek.guardiao_leads`,
-- o consumidor do evento pula.
--
-- Casamento: TELEFONE primeiro (as formas que o servidor manda: com e sem 55, com e sem o 9);
-- se o telefone achar mais de um lead, o NOME desempata; se não achar nenhum, o nome só vale
-- quando aponta UM lead sem dono em IA Atendendo. Lead já com dono não muda de mão.
-- Guardião: o membro ativo com função sdr que recebeu aviso há mais tempo. Sem guardião ativo,
-- o lead fica em Suporte IA sem dono e aparece na faixa (0609).
alter table public.iavek_rodizio_registros drop constraint if exists iavek_rodizio_registros_origem_check;
alter table public.iavek_rodizio_registros add constraint iavek_rodizio_registros_origem_check
  check (origem in ('lead_novo', 'mesmo_dono', 'distribuicao', 'aviso_de_ajuda'));

create or replace function public.fn_iavek_aviso_de_ajuda(p_org uuid, p_telefones text[], p_nome text)
returns table (resultado text, lead_id uuid, user_id uuid, metodo text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome text := nullif(lower(btrim(coalesce(p_nome, ''))), '');
  v_leads uuid[];
  v_metodo text := 'telefone';
  v_lead public.crm_leads%rowtype;
  v_etapa uuid;
  v_guardiao uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('iavek_rodizio:' || p_org::text, 0));

  select array_agg(x.id order by x.created_at desc) into v_leads
    from (select distinct on (l.contact_id) l.id, l.created_at
            from public.crm_leads l
            join public.crm_pipelines p on p.id = l.pipeline_id and p.organization_id = p_org and p.is_default
            join public.contacts c on c.id = l.contact_id and c.organization_id = p_org
           where l.organization_id = p_org
             and l.status = 'open'
             and coalesce(cardinality(p_telefones), 0) > 0
             and regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g') = any (p_telefones)
           order by l.contact_id, l.created_at desc) x;

  if coalesce(array_length(v_leads, 1), 0) > 1 and v_nome is not null then
    select array_agg(l.id) into v_leads
      from public.crm_leads l
      join public.contacts c on c.id = l.contact_id and c.organization_id = p_org
     where l.id = any (v_leads)
       and (lower(btrim(coalesce(c.name, ''))) = v_nome or lower(btrim(coalesce(c.display_name, ''))) = v_nome);
  end if;

  if coalesce(array_length(v_leads, 1), 0) = 0 and v_nome is not null then
    v_metodo := 'nome';
    select array_agg(l.id) into v_leads
      from public.crm_leads l
      join public.crm_pipelines p on p.id = l.pipeline_id and p.organization_id = p_org and p.is_default
      join public.crm_stages s on s.id = l.stage_id and s.slug = 'novo'
      join public.contacts c on c.id = l.contact_id and c.organization_id = p_org
     where l.organization_id = p_org
       and l.status = 'open'
       and l.owner_user_id is null
       and (lower(btrim(coalesce(c.name, ''))) = v_nome or lower(btrim(coalesce(c.display_name, ''))) = v_nome);
  end if;

  if coalesce(array_length(v_leads, 1), 0) = 0 then
    return query select 'nao_reconhecido'::text, null::uuid, null::uuid, null::text;
    return;
  end if;
  if array_length(v_leads, 1) > 1 then
    return query select 'ambiguo'::text, null::uuid, null::uuid, v_metodo;
    return;
  end if;

  select * into v_lead from public.crm_leads l where l.id = v_leads[1] for update;
  if v_lead.owner_user_id is not null or v_lead.owner_agent_id is not null then
    return query select 'ja_tem_dono'::text, v_lead.id, v_lead.owner_user_id, v_metodo;
    return;
  end if;

  select s.id into v_etapa
    from public.crm_stages s
   where s.organization_id = p_org and s.pipeline_id = v_lead.pipeline_id
     and s.slug = 'em-atendimento-ia' and not coalesce(s.is_archived, false)
   limit 1;
  if v_etapa is not null and v_etapa is distinct from v_lead.stage_id then
    update public.crm_leads
       set stage_id = v_etapa,
           position_in_stage = coalesce((select min(x.position_in_stage) from public.crm_leads x where x.stage_id = v_etapa), 1000) - 1
     where id = v_lead.id;
  end if;

  select uo.user_id into v_guardiao
    from public.user_organizations uo
   where uo.organization_id = p_org
     and uo.revoked_at is null
     and uo.role = 'agent'
     and uo.interface_settings->>'funcao' = 'sdr'
   order by (select max(r.created_at) from public.iavek_rodizio_registros r
              where r.organization_id = p_org and r.user_id = uo.user_id and r.origem = 'aviso_de_ajuda') asc nulls first,
            uo.user_id
   limit 1;
  if v_guardiao is null then
    return query select 'sem_guardiao'::text, v_lead.id, null::uuid, v_metodo;
    return;
  end if;

  perform public.fn_iavek_rodizio_entregar(p_org, v_lead.id, v_guardiao, 'aviso_de_ajuda', null);
  return query select 'entregue'::text, v_lead.id, v_guardiao, v_metodo;
end;
$$;
revoke execute on function public.fn_iavek_aviso_de_ajuda(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.fn_iavek_aviso_de_ajuda(uuid, text[], text) to service_role;
