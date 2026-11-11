-- manifest: ia.vek v1.9.46 (0623) — o aviso do grupo (Guardião Leads, CRM-241) entrega pela LISTA do rodízio (só os membros ativos dela, em rodízio); só com a lista vazia cai na regra de antes (as 'sdr' ativas)
--
-- POR QUÊ: o Rodrigo (11/11, 22:27Z) quer a passagem automática "em rodízio entre Daiane e Paloma depois que a IA
-- atende". MEDIDO: a fn_iavek_aviso_de_ajuda entregava para QUALQUER membro 'agent' com função 'sdr', e na Fenômenos
-- são 3 (Paloma, Daiane e a conta 'VEK (vendedor)'): a VEK receberia 1 de cada 3. Decisão do Maestro (223858): o
-- caminho (b), a lista do rodízio vira o lugar único de "quem recebe".
--
-- O QUE MUDA: só a escolha de quem recebe, dentro de fn_iavek_aviso_de_ajuda. O resto do corpo é IDÊNTICO (a trava por
-- organização, o reconhecimento por telefone e nome, o 'ja_tem_dono', o 'ambiguo', a etapa 'Em atendimento IA' e a
-- entrega por fn_iavek_rodizio_entregar). O "ativo" do rodízio não entra: ele é o dos leads NOVOS e segue desligado.
-- A lista da Fenômenos (Daiane e Paloma) é gravada no script da troca da v1.9.46, com backup (não aqui).
-- Idempotente (create or replace). Volta: voltar-0623.sql (devolve o corpo de antes).

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

  -- ia.vek 0623 (v1.9.46, Maestro 223858): QUEM RECEBE é a LISTA do rodízio (settings.iavek.rodizio.participantes),
  -- só os membros ATIVOS dela, em rodízio pelo último aviso de ajuda de cada um. A lista é o lugar único de "quem recebe".
  -- O "ativo" do rodízio NÃO importa aqui: ele liga o rodízio dos leads NOVOS (fn_iavek_rodizio_no_lead_novo), e o
  -- aviso do grupo é outra porta. Com a lista VAZIA (ou sem nenhum ativo), cai na regra de antes: as 'sdr' ativas.
  select p.uid into v_guardiao
    from (select (x.v)::uuid as uid, x.pos
            from jsonb_array_elements_text(coalesce((select o.settings->'iavek'->'rodizio'->'participantes'
                                                       from public.organizations o where o.id = p_org), '[]'::jsonb))
                 with ordinality as x(v, pos)
           where x.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') p
    join public.user_organizations uo on uo.organization_id = p_org and uo.user_id = p.uid and uo.revoked_at is null
   order by (select max(r.created_at) from public.iavek_rodizio_registros r
              where r.organization_id = p_org and r.user_id = p.uid and r.origem = 'aviso_de_ajuda') asc nulls first,
            p.pos
   limit 1;

  if v_guardiao is null then
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
  end if;
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

notify pgrst, 'reload schema';
