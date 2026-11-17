-- manifest: ia.vek v1.9.60 (0646, CRM-491) — um registro por TURNO respondido pela IA, para conferir depois (v1)
--
-- POR QUÊ (CÓDIGO, 17/11, CRM-461): o "por que a IA respondeu assim" fica só no log do worker, que se perde a cada troca
-- de versão; ai_agent_runs não é mais escrito; llm_calls não tem a versão do prompt nem liga à mensagem enviada.
--
-- O QUE MUDA: uma tabela nova, só do servidor, com UMA linha por turno que respondeu: o job (que liga às llm_calls pelo
-- job_id), a conversa, o contato, a mensagem que ele respondeu, as mensagens enviadas, o agente, a VERSÃO publicada do
-- prompt e o modelo, e o nível final de manipulação. SEM texto do cliente (o texto está em messages). Fora da v1: as
-- ferramentas chamadas, os produtos da busca e a versão da memória da loja (R4, parte do R3).
-- Prazo de guarda: decisão do Rodrigo (CRM-487); sem poda até lá. A linha sai com o contato (on delete cascade).
-- EXCLUSIVA do servidor: RLS ligada, zero policies, grants revogados de anon/authenticated. ADITIVA.
-- Volta: voltar-0646.sql (drop table).

create table if not exists public.iavek_turnos_da_ia (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid,
  kind text check (kind is null or length(kind) <= 40),
  conversation_id uuid,
  contact_id uuid references public.contacts(id) on delete cascade,
  inbound_message_id uuid,
  mensagens_enviadas uuid[] not null default '{}',
  agent_id uuid,
  agent_version_id uuid,
  modelo text check (modelo is null or length(modelo) <= 120),
  nivel_manipulacao text check (nivel_manipulacao is null or nivel_manipulacao in ('none', 'low', 'high')),
  criado_em timestamptz not null default now()
);
comment on table public.iavek_turnos_da_ia is
  'ia.vek v1.9.60 (0646, CRM-491): uma linha por turno respondido pela IA (ligações e fatos, sem texto do cliente). Liga às llm_calls por job_id. Só do servidor.';
create index if not exists iavek_turnos_da_ia_conversa on public.iavek_turnos_da_ia (organization_id, conversation_id, criado_em desc);
create index if not exists iavek_turnos_da_ia_job on public.iavek_turnos_da_ia (job_id);

alter table public.iavek_turnos_da_ia enable row level security;
revoke all on public.iavek_turnos_da_ia from public, anon, authenticated;
grant select, insert, update, delete on public.iavek_turnos_da_ia to service_role;

notify pgrst, 'reload schema';
