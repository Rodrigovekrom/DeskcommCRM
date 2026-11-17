-- manifest: ia.vek v1.9.60 (0643, CRM-490) — as limpezas automáticas deixam a ÚLTIMA RODADA registrada, também quando dão certo
--
-- POR QUÊ (MEDIDO 17/11, CRM-462 L6): os crons data-retention (04:40) e media-retention (05:20) só deixam rastro quando
-- FALHAM (o scheduler escreve no log só na falha, e a auditoria retention.sweep_run só nasce quando a rodada apagou algo,
-- regra "auditar quando há efeito"). "Não falhou" não prova "rodou": sem efeito, uma rodada certa e uma que nunca
-- aconteceu ficam iguais.
--
-- O QUE MUDA: uma tabela pequena, UMA linha por rotina (upsert), com a hora da última rodada que terminou e as CONTAGENS
-- dela. Não é auditoria (a regra de auditar só com efeito não muda) e não guarda dado de cliente: só números.
-- EXCLUSIVA do servidor: RLS ligada, zero policies, grants revogados de anon/authenticated (como a 0627).
-- ADITIVA. Volta: voltar-0643.sql (drop table).

create table if not exists public.iavek_rotinas_rodadas (
  rotina text primary key check (length(rotina) between 1 and 60),
  ultima_em timestamptz not null default now(),
  ultimo_resultado jsonb not null default '{}'::jsonb,
  request_id text check (request_id is null or length(request_id) <= 100)
);
comment on table public.iavek_rotinas_rodadas is
  'ia.vek v1.9.60 (0643, CRM-490): a última rodada que TERMINOU de cada rotina automática (data-retention, media-retention), com as contagens. Só do servidor; sem dado de cliente.';

alter table public.iavek_rotinas_rodadas enable row level security;
revoke all on public.iavek_rotinas_rodadas from public, anon, authenticated;
grant select, insert, update, delete on public.iavek_rotinas_rodadas to service_role;

notify pgrst, 'reload schema';
