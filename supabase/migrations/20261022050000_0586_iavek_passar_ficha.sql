-- manifest: ia.vek v1.7.8 — Passar Ficha: o vendedor envia a ficha de crédito do PRÓPRIO lead; a função "Analista de ficha" vê SÓ as fichas (o resto do CRM se fecha no banco); dados e documentos sem acesso direto da sessão, leitura registrada, LGPD na anonimização
--
-- POR QUÊ (decisão do dono do produto, 22/10/2026): a loja passa fichas de
-- financiamento (CPF, RG, renda, documentos) para quem analisa crédito. Isso
-- não pode morar no lead nem na proposta (que vão para o cliente e passam pela
-- IA), e quem analisa não deve ver mais nada do CRM.
--
-- O QUE MUDA
--   1. A função "analista_ficha" (user_organizations.interface_settings.funcao,
--      que só o admin grava) fecha o CRM INTEIRO para aquele vínculo:
--      fn_user_org_ids() e fn_user_role_in_org() não o contam. Toda policy de
--      tenant e todo requireRole() passam a negar — a pessoa só chega às fichas
--      pelas rotas próprias (servidor, com a checagem explícita da função).
--      O analista lê só a LINHA da própria organização (orgs_select_analista_de_ficha).
--   2. iavek_fichas, iavek_ficha_documentos e iavek_ficha_leituras: RLS ligada e
--      NENHUMA policy para a sessão. Só o servidor lê e escreve, depois de
--      conferir quem pede (vendedor dono do lead, analista, admin). Toda leitura
--      de dados ou documento vira linha em iavek_ficha_leituras.
--   3. Bucket privado iavek-fichas, sem policy de storage para a sessão: o
--      documento sai só por URL assinada curta, gerada pelo servidor.
--   4. LGPD: na virada de is_anonymized do contato, os dados da ficha são
--      apagados, o motivo também, e os documentos vão para a fila de remoção do
--      storage (storage_redaction_queue, a mesma da cascata).
--   5. Sino: tipos ficha_enviada e ficha_decidida.
--
-- ADITIVA: tabelas novas vazias, bucket novo, gatilho novo; as duas funções de
-- vínculo só deixam de contar um vínculo cuja função ninguém usa ainda.

-- 1. A função "analista_ficha" fecha o CRM para o vínculo.
create or replace function public.fn_user_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $f$
 select organization_id from public.user_organizations where user_id=auth.uid() and revoked_at is null
   and coalesce(interface_settings->>'funcao', '') <> 'analista_ficha'
 union select (s->>'organization_id')::uuid from (select public.fn_support_context() s) c where s->>'status'='active';
$f$;
create or replace function public.fn_user_role_in_org(p_org uuid)
returns text language sql stable security definer set search_path = public as $f$
 select case when s->>'status'='active' and (s->>'organization_id')::uuid=p_org
 then case when s->>'access_mode'='full' then 'admin' else 'viewer' end
 else (select role from public.user_organizations where user_id=auth.uid() and organization_id=p_org and revoked_at is null
         and coalesce(interface_settings->>'funcao', '') <> 'analista_ficha' limit 1) end
 from (select public.fn_support_context() s) c;
$f$;

-- 1b. O analista ainda precisa da LINHA da própria organização (nome, status,
-- configuração — nada de cliente): sem ela o app trata a loja como suspensa.
-- Policy estreita, só para o vínculo do próprio usuário com a função analista.
drop policy if exists orgs_select_analista_de_ficha on public.organizations;
create policy orgs_select_analista_de_ficha on public.organizations
  for select using (
    id in (select uo.organization_id from public.user_organizations uo
            where uo.user_id = auth.uid() and uo.revoked_at is null
              and uo.interface_settings->>'funcao' = 'analista_ficha')
  );

-- 2. As fichas.
create table if not exists public.iavek_fichas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.crm_leads(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  enviada_por uuid references auth.users(id) on delete set null,
  status text not null default 'enviada'
    check (status in ('enviada', 'pendente_documento', 'aprovada', 'recusada')),
  -- Os valores, chave = campo da lista do admin no momento do envio.
  dados jsonb not null default '{}'::jsonb,
  -- A lista de campos como estava no envio (o admin pode mudá-la depois).
  campos jsonb not null default '[]'::jsonb,
  motivo text,
  decidida_por uuid references auth.users(id) on delete set null,
  decidida_em timestamptz,
  anonimizada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iavek_fichas_motivo_tamanho check (motivo is null or length(motivo) <= 1000)
);
create index if not exists iavek_fichas_fila_idx on public.iavek_fichas (organization_id, status, created_at desc);
create index if not exists iavek_fichas_lead_idx on public.iavek_fichas (organization_id, lead_id);
create index if not exists iavek_fichas_contato_idx on public.iavek_fichas (contact_id);

create table if not exists public.iavek_ficha_documentos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ficha_id uuid not null references public.iavek_fichas(id) on delete cascade,
  tipo text not null default 'outro' check (tipo in ('rg', 'cnh', 'comprovante_renda', 'comprovante_residencia', 'outro')),
  nome text,
  mime text,
  tamanho int,
  storage_path text not null,
  enviado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists iavek_ficha_documentos_ficha_idx on public.iavek_ficha_documentos (ficha_id);

create table if not exists public.iavek_ficha_leituras (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ficha_id uuid not null references public.iavek_fichas(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  o_que text not null check (o_que in ('dados', 'documento')),
  documento_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists iavek_ficha_leituras_ficha_idx on public.iavek_ficha_leituras (ficha_id, created_at desc);

alter table public.iavek_fichas enable row level security;
alter table public.iavek_ficha_documentos enable row level security;
alter table public.iavek_ficha_leituras enable row level security;
-- Sem policy para a sessão, de propósito: só o servidor (service role).
revoke all on table public.iavek_fichas from anon, authenticated;
revoke all on table public.iavek_ficha_documentos from anon, authenticated;
revoke all on table public.iavek_ficha_leituras from anon, authenticated;
grant all on table public.iavek_fichas to service_role;
grant all on table public.iavek_ficha_documentos to service_role;
grant all on table public.iavek_ficha_leituras to service_role;

-- 3. O bucket privado dos documentos (sem policy de storage para a sessão).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('iavek-fichas', 'iavek-fichas', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false;

-- 4. LGPD: anonimizar o contato apaga os dados da ficha e manda os documentos
-- para a fila de remoção do storage.
create or replace function public.fn_iavek_redigir_fichas_ao_anonimizar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.storage_redaction_queue (organization_id, bucket, object_path)
  select d.organization_id, 'iavek-fichas', d.storage_path
    from public.iavek_ficha_documentos d
    join public.iavek_fichas f on f.id = d.ficha_id
   where f.contact_id = new.id
     and f.organization_id = new.organization_id
  on conflict (bucket, object_path) do nothing;

  delete from public.iavek_ficha_documentos d
   using public.iavek_fichas f
   where f.id = d.ficha_id
     and f.contact_id = new.id
     and f.organization_id = new.organization_id;

  update public.iavek_fichas
     set dados = '{}'::jsonb,
         motivo = null,
         anonimizada = true,
         updated_at = now()
   where contact_id = new.id
     and organization_id = new.organization_id
     and anonimizada = false;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_redigir_fichas_ao_anonimizar() from public, anon, authenticated;

drop trigger if exists trg_iavek_redigir_fichas_ao_anonimizar on public.contacts;
create trigger trg_iavek_redigir_fichas_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized = true and old.is_anonymized is distinct from true)
  execute function public.fn_iavek_redigir_fichas_ao_anonimizar();

-- 5. Sino: a ficha chegou (para quem analisa) e foi decidida (para o vendedor).
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
  'ficha_decidida'
));
