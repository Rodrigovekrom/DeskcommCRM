-- manifest: ia.vek CRM-439 fase 1 (0651) — orientações da loja e novidades da versão: 3 tabelas que não se editam nem se apagam, com o "li e entendi" e o sino
--
-- POR QUÊ (Rodrigo, 16/11 "pode seguir" na fase 1; as 5 regras de 21/11): a gerência manda uma orientação a uma FUNÇÃO
-- ou a uma PESSOA, ela aparece no sino e no Meu dia com "li e entendi", a gerência vê quem leu, e tudo fica guardado como
-- o manual da loja. As Novidades da versão seguem o mesmo caminho, escritas pelo time (só pelo servidor).
-- Desenho: docs-iavek-desenhos/D2-crm439-fase1-codigo.md (verde da Lupa 113859 no md5 a11887de, com as condições H e I).
--
-- AS REGRAS:
--   1. só gestor envia (o papel: fn_role_at_least 'manager' ou o admin da plataforma; a rota usa requireRole("manager"));
--   2. nada trava a tela (é só o sino e o Meu dia; nada aqui);
--   3. não se edita nem se apaga: gatilhos por LISTA BRANCA, que valem até para o service_role. A única mudança aceita é
--      enviado_por / para_usuario indo a NULO (o ON DELETE SET NULL de quando a pessoa é apagada); o DELETE só passa no
--      cascade (a org, o comunicado ou a pessoa já não existe);
--   4. as Novidades vêm do servidor (fn_iavek_enviar_comunicado é só do service_role);
--   5. sem push.
-- O ALVO vem da FUNÇÃO (interface_settings.funcao), que não é o papel. 'apoio' conta como 'gerente', a mesma regra da
-- fn_iavek_funcao_na_org (0598); por isso 'apoio' não é um alvo à parte. A 'analista_ficha' também não é alvo: ela não
-- usa o CRM (a fn_user_org_ids a deixa de fora, 0586), e um comunicado para ela ficaria sem leitor. O check de para_funcao fica preso às funções de
-- hoje (lib/iavek/comunicados.ts → FUNCOES_ALVO): uma função nova pede outra migration.
-- O "X de Y leram" conta o RETRATO do envio (_destinatarios): quem sai da loja (revoked_at) segue no Y; só apagar a
-- pessoa de verdade (auth.users) a tira.
-- ADITIVA: 3 tabelas e 2 funções novas, e o check do sino recriado com a lista da 0629 INTEIRA mais 2 tipos.
-- Volta: voltar-0651.sql (ops): apaga as notificacoes dos 2 tipos, devolve o check da 0629, derruba funções e tabelas.

-- ---- 1. as tabelas ----
create table if not exists public.iavek_comunicados (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tipo text not null check (tipo in ('orientacao', 'novidade')),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 120),
  texto text not null check (char_length(btrim(texto)) between 1 and 4000),
  alvo text not null check (alvo in ('funcao', 'pessoa')),
  para_funcao text check (para_funcao is null or para_funcao in ('sdr', 'suporte', 'vendedor', 'gerente', 'sdr_followup')),
  para_usuario uuid references auth.users(id) on delete set null,
  pede_leitura boolean not null default true,
  enviado_por uuid references auth.users(id) on delete set null,
  enviado_em timestamptz not null default now(),
  substitui_id uuid,
  versao text check (versao is null or char_length(btrim(versao)) between 1 and 40),
  constraint iavek_comunicados_org_id_key unique (organization_id, id),
  -- só corrige uma da MESMA org; NO ACTION (nunca SET NULL), para nenhum cascade virar UPDATE no gatilho.
  constraint iavek_comunicados_substitui_fkey foreign key (organization_id, substitui_id)
    references public.iavek_comunicados (organization_id, id),
  constraint iavek_comunicados_substitui_outra check (substitui_id is null or substitui_id <> id),
  -- o para_usuario só fica nulo depois do envio (a pessoa apagada); a função de envio exige que ele venha preenchido.
  constraint iavek_comunicados_alvo_destino_check check (
    (alvo = 'funcao' and para_funcao is not null and para_usuario is null)
    or (alvo = 'pessoa' and para_funcao is null)
  ),
  constraint iavek_comunicados_versao_so_novidade_check check (
    (tipo = 'novidade' and versao is not null) or (tipo = 'orientacao' and versao is null)
  ),
  -- (Lupa H) a orientação sempre pede o "li e entendi"; o enviado_por preenchido NÃO é check (bateria no SET NULL):
  -- quem exige é a função de envio.
  constraint iavek_comunicados_orientacao_pede_leitura check (tipo <> 'orientacao' or pede_leitura)
);
comment on table public.iavek_comunicados is
  'ia.vek CRM-439 (0651): orientações da loja (da gerência) e novidades da versão (do time). Não se editam nem se apagam; quem recebe está em iavek_comunicados_destinatarios.';
create index if not exists iavek_comunicados_por_org on public.iavek_comunicados (organization_id, enviado_em desc);
create index if not exists iavek_comunicados_substitui on public.iavek_comunicados (organization_id, substitui_id)
  where substitui_id is not null;

create table if not exists public.iavek_comunicados_destinatarios (
  comunicado_id uuid not null references public.iavek_comunicados(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funcao_no_envio text,
  primary key (comunicado_id, user_id)
);
comment on table public.iavek_comunicados_destinatarios is
  'ia.vek CRM-439 (0651): o retrato de quem o comunicado alcançou no envio (o Y do "X de Y leram"). Não se edita.';
create index if not exists iavek_comunicados_destinatarios_por_pessoa
  on public.iavek_comunicados_destinatarios (user_id, organization_id);

create table if not exists public.iavek_comunicados_lidos (
  comunicado_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lida_em timestamptz not null default now(),
  primary key (comunicado_id, user_id),
  -- só lê quem é destinatário.
  constraint iavek_comunicados_lidos_destinatario_fkey foreign key (comunicado_id, user_id)
    references public.iavek_comunicados_destinatarios (comunicado_id, user_id) on delete cascade
);
comment on table public.iavek_comunicados_lidos is
  'ia.vek CRM-439 (0651): o "li e entendi" de cada destinatário. Não se edita.';
create index if not exists iavek_comunicados_lidos_por_pessoa
  on public.iavek_comunicados_lidos (user_id, organization_id);

-- ---- 2. as travas (valem para todo papel, até o service_role) ----
create or replace function public.fn_iavek_comunicado_nao_edita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'enviado_por' - 'para_usuario') is distinct from (to_jsonb(old) - 'enviado_por' - 'para_usuario') then
    raise exception 'Um comunicado enviado não se edita: envie outro que corrige.' using errcode = 'PT409';
  end if;
  if new.enviado_por is distinct from old.enviado_por and new.enviado_por is not null then
    raise exception 'Um comunicado enviado não se edita: envie outro que corrige.' using errcode = 'PT409';
  end if;
  if new.para_usuario is distinct from old.para_usuario and new.para_usuario is not null then
    raise exception 'Um comunicado enviado não se edita: envie outro que corrige.' using errcode = 'PT409';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_comunicado_nao_edita() from public, anon, authenticated;

create or replace function public.fn_iavek_comunicado_nao_apaga()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- só o cascade da org passa (a linha da org já não existe quando o cascade chega aqui).
  if exists (select 1 from public.organizations o where o.id = old.organization_id) then
    raise exception 'Um comunicado enviado não se apaga: envie outro que corrige.' using errcode = 'PT409';
  end if;
  return old;
end;
$$;
revoke execute on function public.fn_iavek_comunicado_nao_apaga() from public, anon, authenticated;

create or replace function public.fn_iavek_comunicado_registro_fixo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'O registro de um comunicado não se edita.' using errcode = 'PT409';
  end if;
  -- DELETE: só no cascade (a org, o comunicado ou a pessoa já não existe).
  if exists (select 1 from public.organizations o where o.id = old.organization_id)
     and exists (select 1 from public.iavek_comunicados c where c.id = old.comunicado_id)
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'O registro de um comunicado não se apaga.' using errcode = 'PT409';
  end if;
  return old;
end;
$$;
revoke execute on function public.fn_iavek_comunicado_registro_fixo() from public, anon, authenticated;

drop trigger if exists iavek_comunicados_nao_edita on public.iavek_comunicados;
create trigger iavek_comunicados_nao_edita
  before update on public.iavek_comunicados
  for each row execute function public.fn_iavek_comunicado_nao_edita();
drop trigger if exists iavek_comunicados_nao_apaga on public.iavek_comunicados;
create trigger iavek_comunicados_nao_apaga
  before delete on public.iavek_comunicados
  for each row execute function public.fn_iavek_comunicado_nao_apaga();
drop trigger if exists iavek_comunicados_destinatarios_fixo on public.iavek_comunicados_destinatarios;
create trigger iavek_comunicados_destinatarios_fixo
  before update or delete on public.iavek_comunicados_destinatarios
  for each row execute function public.fn_iavek_comunicado_registro_fixo();
drop trigger if exists iavek_comunicados_lidos_fixo on public.iavek_comunicados_lidos;
create trigger iavek_comunicados_lidos_fixo
  before update or delete on public.iavek_comunicados_lidos
  for each row execute function public.fn_iavek_comunicado_registro_fixo();

-- ---- 3. a RLS e os grants ----
alter table public.iavek_comunicados enable row level security;
alter table public.iavek_comunicados_destinatarios enable row level security;
alter table public.iavek_comunicados_lidos enable row level security;

drop policy if exists iavek_comunicados_select on public.iavek_comunicados;
create policy iavek_comunicados_select on public.iavek_comunicados
  for select to authenticated
  using (
    public.fn_is_platform_admin_full()
    or (
      organization_id in (select public.fn_user_org_ids())
      and (
        public.fn_role_at_least(organization_id, 'manager')
        or exists (
          select 1 from public.iavek_comunicados_destinatarios d
           where d.comunicado_id = iavek_comunicados.id and d.user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists iavek_comunicados_destinatarios_select on public.iavek_comunicados_destinatarios;
create policy iavek_comunicados_destinatarios_select on public.iavek_comunicados_destinatarios
  for select to authenticated
  using (
    public.fn_is_platform_admin_full()
    or (
      organization_id in (select public.fn_user_org_ids())
      and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
    )
  );

drop policy if exists iavek_comunicados_lidos_select on public.iavek_comunicados_lidos;
create policy iavek_comunicados_lidos_select on public.iavek_comunicados_lidos
  for select to authenticated
  using (
    public.fn_is_platform_admin_full()
    or (
      organization_id in (select public.fn_user_org_ids())
      and (user_id = auth.uid() or public.fn_role_at_least(organization_id, 'manager'))
    )
  );

drop policy if exists iavek_comunicados_lidos_insert on public.iavek_comunicados_lidos;
create policy iavek_comunicados_lidos_insert on public.iavek_comunicados_lidos
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and organization_id in (select public.fn_user_org_ids())
    -- (Lupa 121236) a org da leitura é a do retrato do envio.
    and exists (
      select 1 from public.iavek_comunicados_destinatarios d
       where d.comunicado_id = iavek_comunicados_lidos.comunicado_id
         and d.user_id = auth.uid()
         and d.organization_id = iavek_comunicados_lidos.organization_id
    )
  );

revoke all on table public.iavek_comunicados from public, anon, authenticated;
revoke all on table public.iavek_comunicados_destinatarios from public, anon, authenticated;
revoke all on table public.iavek_comunicados_lidos from public, anon, authenticated;
grant select on table public.iavek_comunicados to authenticated;
grant select on table public.iavek_comunicados_destinatarios to authenticated;
grant select, insert on table public.iavek_comunicados_lidos to authenticated;
grant select, insert, update, delete on table public.iavek_comunicados to service_role;
grant select, insert, update, delete on table public.iavek_comunicados_destinatarios to service_role;
grant select, insert, update, delete on table public.iavek_comunicados_lidos to service_role;

-- ---- 4. o sino: a lista da 0629 INTEIRA mais os 2 tipos novos ----
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
  'ia_travou',
  'agendamento_no_seu_lead',
  -- ia.vek CRM-439 (migration 0651): a orientação da gerência e a novidade da versão.
  'orientacao_da_loja',
  'novidade_da_versao'
));

-- ---- 5. enviar: tudo numa só chamada (Lupa C), só do servidor ----
create or replace function public.fn_iavek_enviar_comunicado(
  p_org uuid,
  p_tipo text,
  p_titulo text,
  p_texto text,
  p_alvo text,
  p_para_funcao text,
  p_para_usuario uuid,
  p_pede_leitura boolean,
  p_enviado_por uuid,
  p_substitui_id uuid,
  p_versao text
)
returns table (comunicado_id uuid, destinatarios integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer;
begin
  -- (Lupa H) a definer não passa pela RLS: quem envia e para quem são conferidos AQUI, na mesma org.
  if p_tipo = 'orientacao' and p_enviado_por is null then
    raise exception 'A orientação precisa de quem a enviou.' using errcode = 'PT422';
  end if;
  if p_enviado_por is not null and not exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = p_org and uo.user_id = p_enviado_por and uo.revoked_at is null
  ) then
    raise exception 'Quem envia não é um membro ativo desta organização.' using errcode = 'PT403';
  end if;
  if p_alvo = 'pessoa' and (p_para_usuario is null or not exists (
    select 1 from public.user_organizations uo
     where uo.organization_id = p_org and uo.user_id = p_para_usuario and uo.revoked_at is null
       and coalesce(uo.interface_settings->>'funcao', '') <> 'analista_ficha'
  )) then
    raise exception 'A pessoa escolhida não é um membro ativo desta organização.' using errcode = 'PT422';
  end if;
  if p_substitui_id is not null and not exists (
    select 1 from public.iavek_comunicados c
     where c.id = p_substitui_id and c.organization_id = p_org and c.tipo = p_tipo
  ) then
    raise exception 'O comunicado corrigido não é desta organização nem do mesmo tipo.' using errcode = 'PT422';
  end if;

  insert into public.iavek_comunicados
    (organization_id, tipo, titulo, texto, alvo, para_funcao, para_usuario, pede_leitura, enviado_por, substitui_id, versao)
  values
    (p_org, p_tipo, btrim(p_titulo), btrim(p_texto), p_alvo,
     case when p_alvo = 'funcao' then p_para_funcao end,
     case when p_alvo = 'pessoa' then p_para_usuario end,
     coalesce(p_pede_leitura, true), p_enviado_por, p_substitui_id, p_versao)
  returning id into v_id;

  -- o retrato: os membros ATIVOS alcançados agora, sem quem enviou. 'apoio' conta como 'gerente' (0598).
  insert into public.iavek_comunicados_destinatarios (comunicado_id, user_id, organization_id, funcao_no_envio)
  select distinct on (uo.user_id)
         v_id, uo.user_id, p_org,
         case uo.interface_settings->>'funcao' when 'apoio' then 'gerente' else uo.interface_settings->>'funcao' end
    from public.user_organizations uo
   where uo.organization_id = p_org
     and uo.revoked_at is null
     -- a analista de ficha não usa o CRM (a fn_user_org_ids a deixa de fora, 0586): nunca é destinatária.
     and coalesce(uo.interface_settings->>'funcao', '') <> 'analista_ficha'
     and uo.user_id is distinct from p_enviado_por
     and (
       (p_alvo = 'funcao'
         and (case uo.interface_settings->>'funcao' when 'apoio' then 'gerente' else uo.interface_settings->>'funcao' end) = p_para_funcao)
       or (p_alvo = 'pessoa' and uo.user_id = p_para_usuario)
     )
   order by uo.user_id;
  get diagnostics v_n = row_count;

  if v_n = 0 then
    -- desfaz o comunicado inteiro (a exceção leva a transação da chamada junto).
    raise exception 'Ninguém recebe este comunicado: confira a função ou a pessoa.' using errcode = 'PT422';
  end if;

  -- o sino: sem o texto (o título e a versão só para a linha do sino).
  insert into public.notificacoes (organization_id, user_id, tipo, ator_user_id, dados)
  select p_org, d.user_id,
         case p_tipo when 'orientacao' then 'orientacao_da_loja' else 'novidade_da_versao' end,
         p_enviado_por,
         jsonb_strip_nulls(jsonb_build_object('comunicado_id', v_id, 'titulo', btrim(p_titulo), 'versao', p_versao))
    from public.iavek_comunicados_destinatarios d
   where d.comunicado_id = v_id;

  return query select v_id, v_n;
end;
$$;
revoke execute on function public.fn_iavek_enviar_comunicado(uuid, text, text, text, text, text, uuid, boolean, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_iavek_enviar_comunicado(uuid, text, text, text, text, text, uuid, boolean, uuid, uuid, text)
  to service_role;

-- ---- 6. o "li e entendi": INVOKER (a RLS vale), numa só chamada ----
create or replace function public.fn_iavek_li_e_entendi(p_comunicado uuid)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_lida timestamptz;
begin
  select d.organization_id into v_org
    from public.iavek_comunicados_destinatarios d
   where d.comunicado_id = p_comunicado and d.user_id = auth.uid();
  if v_org is null then
    raise exception 'Este comunicado não é para você.' using errcode = 'PT404';
  end if;

  insert into public.iavek_comunicados_lidos (comunicado_id, user_id, organization_id)
  values (p_comunicado, auth.uid(), v_org)
  on conflict (comunicado_id, user_id) do nothing;

  update public.notificacoes n
     set lida_em = now()
   where n.user_id = auth.uid()
     and n.organization_id = v_org
     and n.tipo in ('orientacao_da_loja', 'novidade_da_versao')
     and n.dados->>'comunicado_id' = p_comunicado::text
     and n.lida_em is null;

  select l.lida_em into v_lida
    from public.iavek_comunicados_lidos l
   where l.comunicado_id = p_comunicado and l.user_id = auth.uid();
  return v_lida;
end;
$$;
revoke execute on function public.fn_iavek_li_e_entendi(uuid) from public, anon;
grant execute on function public.fn_iavek_li_e_entendi(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
