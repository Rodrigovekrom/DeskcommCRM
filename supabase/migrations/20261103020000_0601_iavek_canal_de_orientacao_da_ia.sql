-- manifest: ia.vek v1.9.13 (0601) — canal de orientação da IA: a Suporte IA orienta a IA na conversa (guardado para a revisão semanal), e o sino avisa quando a IA trava, com o motivo. Nasce desligado por empresa
--
-- O PEDIDO (dono do produto, 30/10; card CRM-220)
--   A pessoa do Suporte IA não responde no lugar da IA: orienta a IA no quadro
--   "Assistência do agente", e a IA escreve ao cliente. Nas primeiras semanas ela
--   aprova o texto com 1 clique (`ai_agents.operation_mode = 'assisted'`, que já
--   existe; passar a 'automatic' é o "depois sai direto"). A IA avisa no sino
--   quando trava. A IA NÃO aprende sozinha: a orientação vale só naquela conversa
--   e fica guardada; a revisão semanal decide o que vira regra fixa.
--
-- DESLIGADO: sem `settings.iavek.canal_orientacao_ia.ativo = true`, ninguém orienta
-- e o sino não avisa. A chave é da empresa, e ligar a IA é outra decisão.
--
-- ADITIVA: 1 tabela, 1 tipo de aviso, funções e 2 gatilhos. Nenhum dado muda.

create table if not exists public.iavek_orientacoes_da_ia (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  autor_user_id uuid references auth.users(id) on delete set null,
  texto text not null check (length(btrim(texto)) between 1 and 1000),
  revisao text check (revisao in ('virou_regra', 'descartada')),
  revisada_em timestamptz,
  revisada_por uuid references auth.users(id) on delete set null,
  criada_em timestamptz not null default now()
);
create index if not exists iavek_orientacoes_da_ia_conversa
  on public.iavek_orientacoes_da_ia (organization_id, conversation_id, criada_em desc);
create index if not exists iavek_orientacoes_da_ia_contato
  on public.iavek_orientacoes_da_ia (organization_id, contact_id);
create index if not exists iavek_orientacoes_da_ia_revisao
  on public.iavek_orientacoes_da_ia (organization_id, criada_em desc) where revisao is null;

alter table public.iavek_orientacoes_da_ia enable row level security;
revoke all on table public.iavek_orientacoes_da_ia from anon, authenticated;
grant select on table public.iavek_orientacoes_da_ia to authenticated;
grant all on table public.iavek_orientacoes_da_ia to service_role;
-- Quem escreveu lê a sua; gerente e admin leem todas (é a fila da revisão).
drop policy if exists tenant_isolation_iavek_orientacoes_da_ia_all on public.iavek_orientacoes_da_ia;
create policy tenant_isolation_iavek_orientacoes_da_ia_all on public.iavek_orientacoes_da_ia
  for select to authenticated using (
    organization_id in (select public.fn_user_org_ids())
    and (autor_user_id = (select auth.uid()) or public.fn_role_at_least(organization_id, 'manager'))
  );

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
  'aviso_da_loja',
  -- ia.vek v1.9.13 (migration 0601): a IA travou nesta conversa, com o motivo.
  'ia_travou'
));

-- A chave da empresa. Ausente = desligado.
create or replace function public.fn_iavek_canal_da_ia_ativo(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (o.settings->'iavek'->'canal_orientacao_ia'->>'ativo') = 'true'
                     from public.organizations o where o.id = p_org), false);
$$;
revoke execute on function public.fn_iavek_canal_da_ia_ativo(uuid) from public, anon;
grant execute on function public.fn_iavek_canal_da_ia_ativo(uuid) to authenticated, service_role;

-- Orientar: guarda e invalida a sugestão atual (a conversa mudou), na mesma
-- transação. Quem orienta: Suporte IA, gerente e admin.
create or replace function public.fn_iavek_orientar_ia(p_org uuid, p_conversa uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contato uuid;
  v_dono uuid;
  v_id uuid;
begin
  if auth.uid() is null or p_org not in (select public.fn_user_org_ids()) then
    raise exception 'orientacao_sem_permissao' using errcode = '42501';
  end if;
  if not public.fn_iavek_canal_da_ia_ativo(p_org) then
    raise exception 'canal_desligado' using errcode = '42501';
  end if;
  if not (public.fn_role_at_least(p_org, 'manager')
          or (public.fn_role_at_least(p_org, 'agent') and public.fn_iavek_funcao_na_org(p_org) = 'suporte')) then
    raise exception 'orientacao_sem_permissao' using errcode = '42501';
  end if;
  if not public.fn_support_write_allowed(p_org) then
    raise exception 'orientacao_sem_permissao' using errcode = '42501';
  end if;
  select contact_id, assigned_to_user_id into v_contato, v_dono
    from public.conversations where organization_id = p_org and id = p_conversa;
  if v_contato is null or not public.fn_can_view_conversation(p_org, v_dono) then
    raise exception 'orientacao_sem_permissao' using errcode = '42501';
  end if;
  perform public.fn_service_lock(p_org, v_contato);
  insert into public.iavek_orientacoes_da_ia (organization_id, conversation_id, contact_id, autor_user_id, texto)
  values (p_org, p_conversa, v_contato, auth.uid(), btrim(p_texto))
  returning id into v_id;
  update public.conversations
     set reply_context_revision = reply_context_revision + 1
   where organization_id = p_org and id = p_conversa;
  return v_id;
end;
$$;
revoke execute on function public.fn_iavek_orientar_ia(uuid, uuid, text) from public, anon;
grant execute on function public.fn_iavek_orientar_ia(uuid, uuid, text) to authenticated;

-- A revisão semanal: gerente ou admin marca o que virou regra e o que foi descartado.
create or replace function public.fn_iavek_revisar_orientacao(p_org uuid, p_id uuid, p_revisao text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'manager') or not public.fn_support_write_allowed(p_org) then
    raise exception 'orientacao_sem_permissao' using errcode = '42501';
  end if;
  update public.iavek_orientacoes_da_ia
     set revisao = p_revisao, revisada_em = now(), revisada_por = auth.uid()
   where organization_id = p_org and id = p_id;
  return found;
end;
$$;
revoke execute on function public.fn_iavek_revisar_orientacao(uuid, uuid, text) from public, anon;
grant execute on function public.fn_iavek_revisar_orientacao(uuid, uuid, text) to authenticated;

-- O sino: quem é do Suporte IA; sem ninguém nessa função, os admins. Um aviso por
-- conversa e motivo enquanto o anterior não foi lido.
create or replace function public.fn_iavek_avisar_trava(p_org uuid, p_conversa uuid, p_codigo text, p_motivo text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead uuid;
  v_n integer;
  v_destino uuid[];
begin
  if not public.fn_iavek_canal_da_ia_ativo(p_org) then
    return 0;
  end if;
  select coalesce(array_agg(uo.user_id), '{}') into v_destino
    from public.user_organizations uo
   where uo.organization_id = p_org and uo.revoked_at is null and uo.accepted_at is not null
     and uo.interface_settings->>'funcao' = 'suporte';
  if cardinality(v_destino) = 0 then
    select coalesce(array_agg(uo.user_id), '{}') into v_destino
      from public.user_organizations uo
     where uo.organization_id = p_org and uo.revoked_at is null and uo.accepted_at is not null and uo.role = 'admin';
  end if;
  select l.id into v_lead
    from public.crm_leads l
    join public.conversations c on c.organization_id = l.organization_id and c.contact_id = l.contact_id
   where c.organization_id = p_org and c.id = p_conversa and l.status = 'open'
   order by l.created_at desc limit 1;
  insert into public.notificacoes (organization_id, user_id, tipo, lead_id, dados)
  select p_org, u, 'ia_travou', v_lead,
         jsonb_build_object('codigo', p_codigo, 'motivo', left(p_motivo, 200), 'conversa_id', p_conversa)
    from unnest(v_destino) u
   where not exists (
     select 1 from public.notificacoes n
      where n.organization_id = p_org and n.user_id = u and n.tipo = 'ia_travou' and n.lida_em is null
        and n.dados->>'conversa_id' = p_conversa::text and n.dados->>'codigo' = p_codigo
   );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.fn_iavek_avisar_trava(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fn_iavek_avisar_trava(uuid, uuid, text, text) to service_role;

-- Gatilho da Central: o que já vira aviso de IA parada vira também sino. O título
-- da Central não traz frase do cliente. Um erro aqui nunca derruba o atendimento.
create or replace function public.fn_iavek_trava_pela_central()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_iavek_avisar_trava(new.organization_id, new.ref_id, new.kind, new.title);
  return null;
exception when others then
  return null;
end;
$$;
revoke execute on function public.fn_iavek_trava_pela_central() from public, anon, authenticated;

drop trigger if exists trg_iavek_trava_pela_central on public.agent_inbox_items;
create trigger trg_iavek_trava_pela_central
  after insert on public.agent_inbox_items
  for each row
  when (new.ref_kind = 'conversation' and new.ref_id is not null
        and new.kind in ('handoff', 'budget_exceeded', 'capabilities_missing', 'midia_nao_lida', 'message_send_stuck'))
  execute function public.fn_iavek_trava_pela_central();

-- Gatilho da sugestão: a IA não conseguiu escrever.
create or replace function public.fn_iavek_trava_pela_sugestao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_iavek_avisar_trava(new.organization_id, new.conversation_id,
    coalesce(new.error_code, 'sugestao_falhou'), 'não conseguiu escrever a resposta');
  return null;
exception when others then
  return null;
end;
$$;
revoke execute on function public.fn_iavek_trava_pela_sugestao() from public, anon, authenticated;

drop trigger if exists trg_iavek_trava_pela_sugestao on public.ai_reply_drafts;
create trigger trg_iavek_trava_pela_sugestao
  after update of status on public.ai_reply_drafts
  for each row
  when (new.status = 'failed' and old.status is distinct from 'failed')
  execute function public.fn_iavek_trava_pela_sugestao();
