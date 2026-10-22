-- manifest: ia.vek v1.7.7 — rodízio de leads: o lead NOVO que nasce sem dono no funil padrão vai para o próximo vendedor da fila (configuração só do admin, desligada por padrão); registro de quem recebeu o quê; distribuição dos antigos sem dono com prévia
--
-- POR QUÊ (decisão do dono do produto, 22/10/2026): na produção, todos os
-- leads abertos estavam sem dono e nenhuma conversa tinha atendente — a
-- carteira do vendedor (Pipeline, v1.7.7) ficava vazia. O admin liga o
-- rodízio e escolhe quem participa; cada lead novo vai, na hora em que chega,
-- para quem está há mais tempo sem receber.
--
-- O QUE NÃO MUDA (fluxo existente respeitado):
--   · Lead que já nasce com dono (criado à mão, passado pelo SDR, clonado com
--     dono) não é tocado — o gatilho só olha lead SEM dono.
--   · Contato que já tem dono (outro lead dele com dono, ou conversa com
--     atendente) continua com o MESMO dono: "mesmo_dono", e não gasta a vez
--     de ninguém no rodízio.
--   · Só o funil PADRÃO (onde o lead novo entra) e nunca importação de
--     planilha: lead antigo não é distribuído sozinho.
--   · A conversa livre do contato vai junto para o mesmo vendedor pela RPC
--     de sempre (`fn_conversation_assign`) com o motivo 'routing' — o que NÃO
--     cala o atendimento automático (a IA, quando publicada, segue atendendo
--     até o handoff).
--
-- CONFIGURAÇÃO: `organizations.settings.iavek.rodizio = { ativo, participantes }`
-- (código; escrita só do admin pela API). Desligado e sem participantes por
-- padrão: sem a chave, o gatilho não faz nada.
--
-- ADITIVA: tabela nova (nasce vazia), funções novas, gatilho novo que não age
-- enquanto o admin não ligar. Nenhum dado existente muda.

create table if not exists public.iavek_rodizio_registros (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  -- lead_novo: o rodízio escolheu. mesmo_dono: o contato já era de alguém.
  -- distribuicao: o admin distribuiu os antigos sem dono.
  origem text not null check (origem in ('lead_novo', 'mesmo_dono', 'distribuicao')),
  decidido_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists iavek_rodizio_registros_vez_idx
  on public.iavek_rodizio_registros (organization_id, user_id, created_at desc)
  where origem in ('lead_novo', 'distribuicao');
create index if not exists iavek_rodizio_registros_lead_idx
  on public.iavek_rodizio_registros (lead_id);

alter table public.iavek_rodizio_registros enable row level security;

-- Quem lê o registro: o admin da organização. Quem escreve: só as funções
-- abaixo (security definer) e o servidor.
drop policy if exists iavek_rodizio_registros_select on public.iavek_rodizio_registros;
create policy iavek_rodizio_registros_select on public.iavek_rodizio_registros
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));

revoke all on table public.iavek_rodizio_registros from anon, authenticated;
grant select on table public.iavek_rodizio_registros to authenticated;
grant all on table public.iavek_rodizio_registros to service_role;

-- Os participantes ATIVOS, na ordem do admin, com a última vez que cada um
-- recebeu pelo rodízio (nulo = nunca). Membro revogado ou abaixo de agent sai.
create or replace function public.fn_iavek_rodizio_fila(p_org uuid)
returns table (user_id uuid, ordem int, ultima_vez timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.uid,
         p.ordem::int,
         (select max(r.created_at)
            from public.iavek_rodizio_registros r
           where r.organization_id = p_org
             and r.user_id = p.uid
             and r.origem in ('lead_novo', 'distribuicao'))
    from (
      select (e.valor)::uuid as uid, e.ordem
        from public.organizations o,
             jsonb_array_elements_text(coalesce(o.settings->'iavek'->'rodizio'->'participantes', '[]'::jsonb))
               with ordinality as e(valor, ordem)
       where o.id = p_org
         and e.valor ~ '^[0-9a-fA-F-]{36}$'
    ) p
   where coalesce(public.fn_member_role_in_org(p.uid, p_org), 'none') in ('agent', 'manager', 'admin');
$$;
revoke execute on function public.fn_iavek_rodizio_fila(uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_rodizio_fila(uuid) to service_role;

-- O dono que o contato JÁ tem: outro lead dele com dono ativo, ou a conversa
-- com atendente ativo. Nulo = ninguém.
create or replace function public.fn_iavek_dono_do_contato(p_org uuid, p_contact uuid, p_exceto_lead uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.owner_user_id
       from public.crm_leads l
      where l.organization_id = p_org
        and l.contact_id = p_contact
        and l.id <> p_exceto_lead
        and l.owner_user_id is not null
        and coalesce(public.fn_member_role_in_org(l.owner_user_id, p_org), 'none') in ('agent', 'manager', 'admin')
      order by l.updated_at desc
      limit 1),
    (select c.assigned_to_user_id
       from public.conversations c
      where c.organization_id = p_org
        and c.contact_id = p_contact
        and coalesce(c.is_group, false) = false
        and c.assigned_to_user_id is not null
        and coalesce(public.fn_member_role_in_org(c.assigned_to_user_id, p_org), 'none') in ('agent', 'manager', 'admin')
      order by c.last_message_at desc nulls last
      limit 1)
  );
$$;
revoke execute on function public.fn_iavek_dono_do_contato(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_dono_do_contato(uuid, uuid, uuid) to service_role;

-- Entrega UM lead a UMA pessoa: dono do lead (só se ainda sem dono), a
-- conversa livre do contato pela RPC de sempre (motivo 'routing', não cala a
-- IA) e a linha do registro. Devolve true se entregou.
create or replace function public.fn_iavek_rodizio_entregar(
  p_org uuid, p_lead uuid, p_user uuid, p_origem text, p_por uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contato uuid;
  v_conversa uuid;
begin
  update public.crm_leads
     set owner_user_id = p_user,
         owner_agent_id = null,
         owner_kind = 'user',
         assigned_at = now()
   where organization_id = p_org
     and id = p_lead
     and owner_user_id is null
     and owner_agent_id is null
  returning contact_id into v_contato;
  if not found then
    return false;
  end if;

  if v_contato is not null then
    select c.id into v_conversa
      from public.conversations c
     where c.organization_id = p_org
       and c.contact_id = v_contato
       and coalesce(c.is_group, false) = false
       and c.status <> 'archived'
       and c.assigned_to_user_id is null
     order by c.last_message_at desc nulls last
     limit 1;
    if v_conversa is not null then
      perform public.fn_conversation_assign(p_org, v_conversa, p_user, 'routing', null, true);
    end if;
  end if;

  insert into public.iavek_rodizio_registros (organization_id, lead_id, user_id, origem, decidido_por)
  values (p_org, p_lead, p_user, p_origem, p_por);
  return true;
end;
$$;
revoke execute on function public.fn_iavek_rodizio_entregar(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_rodizio_entregar(uuid, uuid, uuid, text, uuid) to service_role;

-- O gatilho: lead NOVO, sem dono, no funil padrão, fora de importação, com o
-- rodízio ligado.
create or replace function public.fn_iavek_rodizio_no_lead_novo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb;
  v_dono uuid;
  v_origem text := 'lead_novo';
begin
  select o.settings->'iavek'->'rodizio' into v_cfg
    from public.organizations o where o.id = new.organization_id;
  if coalesce((v_cfg->>'ativo')::boolean, false) is not true then
    return null;
  end if;
  if coalesce(new.source, '') = 'import' then
    return null;
  end if;
  if not exists (select 1 from public.crm_pipelines p
                  where p.id = new.pipeline_id and p.organization_id = new.organization_id and p.is_default) then
    return null;
  end if;

  -- Uma vez por organização: dois leads chegando juntos não pegam a mesma vez.
  perform pg_advisory_xact_lock(hashtextextended('iavek_rodizio:' || new.organization_id::text, 0));

  if new.contact_id is not null then
    v_dono := public.fn_iavek_dono_do_contato(new.organization_id, new.contact_id, new.id);
    if v_dono is not null then
      v_origem := 'mesmo_dono';
    end if;
  end if;

  if v_dono is null then
    select f.user_id into v_dono
      from public.fn_iavek_rodizio_fila(new.organization_id) f
     order by f.ultima_vez asc nulls first, f.ordem asc
     limit 1;
  end if;
  if v_dono is null then
    return null; -- ligado, mas sem participante ativo: o lead fica sem dono.
  end if;

  perform public.fn_iavek_rodizio_entregar(new.organization_id, new.id, v_dono, v_origem, null);
  return null;
end;
$$;
revoke execute on function public.fn_iavek_rodizio_no_lead_novo() from public, anon, authenticated;

drop trigger if exists trg_iavek_rodizio_no_lead_novo on public.crm_leads;
create trigger trg_iavek_rodizio_no_lead_novo
  after insert on public.crm_leads
  for each row
  when (new.owner_user_id is null and new.owner_agent_id is null and new.status = 'open')
  execute function public.fn_iavek_rodizio_no_lead_novo();

-- Os ANTIGOS sem dono do funil padrão, pelo rodízio — ação do admin, com
-- prévia. `p_confirmar = false` só calcula (quantos para cada um); `true`
-- entrega. Contato que já tem dono vai para o mesmo dono. A vez segue a fila
-- (quem está há mais tempo sem receber primeiro) e depois gira na ordem.
create or replace function public.fn_iavek_rodizio_distribuir(p_org uuid, p_por uuid, p_confirmar boolean)
returns table (user_id uuid, quantidade int, mesmo_dono int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila uuid[];
  v_n int;
  v_i int := 0;
  v_lead record;
  v_dono uuid;
  v_origem text;
  v_conta jsonb := '{}'::jsonb;
  v_mesmo jsonb := '{}'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('iavek_rodizio:' || p_org::text, 0));

  select array_agg(f.user_id order by f.ultima_vez asc nulls first, f.ordem asc)
    into v_fila
    from public.fn_iavek_rodizio_fila(p_org) f;
  v_n := coalesce(array_length(v_fila, 1), 0);
  if v_n = 0 then
    return;
  end if;

  for v_lead in
    select l.id, l.contact_id
      from public.crm_leads l
      join public.crm_pipelines p on p.id = l.pipeline_id and p.is_default
     where l.organization_id = p_org
       and p.organization_id = p_org
       and l.status = 'open'
       and l.owner_user_id is null
       and l.owner_agent_id is null
     order by l.created_at asc
  loop
    v_dono := null;
    v_origem := 'distribuicao';
    if v_lead.contact_id is not null then
      v_dono := public.fn_iavek_dono_do_contato(p_org, v_lead.contact_id, v_lead.id);
      if v_dono is not null then v_origem := 'mesmo_dono'; end if;
    end if;
    if v_dono is null then
      v_dono := v_fila[(v_i % v_n) + 1];
      v_i := v_i + 1;
    end if;

    if not p_confirmar or public.fn_iavek_rodizio_entregar(p_org, v_lead.id, v_dono, v_origem, p_por) then
      if v_origem = 'mesmo_dono' then
        v_mesmo := jsonb_set(v_mesmo, array[v_dono::text], to_jsonb(coalesce((v_mesmo->>v_dono::text)::int, 0) + 1));
      else
        v_conta := jsonb_set(v_conta, array[v_dono::text], to_jsonb(coalesce((v_conta->>v_dono::text)::int, 0) + 1));
      end if;
    end if;
  end loop;

  return query
    select k::uuid,
           coalesce((v_conta->>k)::int, 0),
           coalesce((v_mesmo->>k)::int, 0)
      from (select jsonb_object_keys(v_conta) as k
            union
            select jsonb_object_keys(v_mesmo)) ks;
end;
$$;
revoke execute on function public.fn_iavek_rodizio_distribuir(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_iavek_rodizio_distribuir(uuid, uuid, boolean) to service_role;
