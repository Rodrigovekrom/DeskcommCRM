-- manifest: ia.vek v1.7.9 — preferências de VISUALIZAÇÃO por pessoa (Pipeline: colunas recolhidas/ocultas e ordenação), numa tabela própria em que cada um lê e grava só a própria linha — nunca em user_organizations.interface_settings
--
-- POR QUÊ (decisão do dono do produto, 22/10/2026): o vendedor personaliza só
-- a VISTA do Pipeline (recolher/ocultar colunas, ordenar por atividade
-- recente); as etapas continuam oficiais do admin.
--
-- POR QUE NÃO EM interface_settings: é ali que mora a FUNÇÃO do vínculo, e a
-- função "analista_ficha" fecha o CRM (migration 0586). Preferência que a
-- própria pessoa grava não pode morar no mesmo campo (regra registrada na
-- v1.7.8, com cerca em tests/unit/iavek-v178-passar-ficha.test.ts).
--
-- ADITIVA: tabela nova, vazia. RLS: a linha é de `user_id = auth.uid()` na
-- organização em que a pessoa é membro; ninguém lê nem grava a de outro.

create table if not exists public.iavek_preferencias_de_tela (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tela text not null check (tela in ('pipeline')),
  valor jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint iavek_preferencias_de_tela_valor_objeto check (jsonb_typeof(valor) = 'object' and pg_column_size(valor) < 8192),
  constraint iavek_preferencias_de_tela_unica unique (organization_id, user_id, tela)
);

alter table public.iavek_preferencias_de_tela enable row level security;

drop policy if exists iavek_preferencias_de_tela_propria on public.iavek_preferencias_de_tela;
create policy iavek_preferencias_de_tela_propria on public.iavek_preferencias_de_tela
  for all to authenticated
  using (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()))
  with check (user_id = auth.uid() and organization_id in (select public.fn_user_org_ids()));

revoke all on table public.iavek_preferencias_de_tela from anon, authenticated;
grant select, insert, update, delete on table public.iavek_preferencias_de_tela to authenticated;
grant all on table public.iavek_preferencias_de_tela to service_role;
