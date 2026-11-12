-- manifest: ia.vek v1.9.47 (0627) — saber se o e-mail CHEGOU (Maestro 210359, da Lupa): a entrega de cada e-mail
-- enviado pela Resend, com o estado que o webhook dela conta (entregue, atrasado, voltou, marcado como spam).
--
-- Por quê: hoje o convite diz só "e-mail enviado" (a Resend ACEITOU). Se ele volta (endereço errado, caixa cheia)
-- ou cai no spam, ninguém fica sabendo, e a pessoa convidada nunca entra.
--
-- iavek_entregas_de_email: uma linha por e-mail aceito pela Resend (mensagem_id = o id que a Resend devolve).
--   - Gravada pelo SERVIDOR no envio (lib/email/entregas.ts, chamada pelo roteador quando o envio sai pela Resend).
--   - Atualizada pelo webhook da Resend (POST /api/v1/webhooks/resend, assinado pelo Svix; o segredo vai no .env
--     do servidor, nunca no chat). Evento de um id que NÃO está aqui é ignorado: nunca cria linha de fora.
--   - O estado só SOBE na ordem enviado < atrasado < entregue < voltou/spam/falhou (os eventos podem chegar fora
--     de ordem: um "entregue" atrasado nunca apaga um "voltou").
--   - NÃO guarda o endereço de quem recebe (ele já está no api_audit_log do convite); o detalhe do retorno é
--     cortado e sem e-mail.
-- EXCLUSIVA do servidor: RLS ligada, zero policies, grants revogados de anon/authenticated (como a 0622). A tela
-- lê pelo servidor, já filtrando pela organização.
-- ADITIVA: nenhuma linha existente muda. Volta: voltar-0627.sql (ops) apaga a tabela (só o histórico de entrega).

create table if not exists public.iavek_entregas_de_email (
  mensagem_id text primary key check (length(mensagem_id) between 1 and 200),
  provedor text not null default 'resend' check (provedor in ('resend')),
  organization_id uuid references public.organizations(id) on delete cascade,
  tipo text check (tipo is null or length(tipo) <= 60),
  recurso_id text check (recurso_id is null or length(recurso_id) <= 100),
  estado text not null default 'enviado'
    check (estado in ('enviado', 'atrasado', 'entregue', 'voltou', 'spam', 'falhou')),
  detalhe text check (detalhe is null or length(detalhe) <= 300),
  enviado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
comment on table public.iavek_entregas_de_email is
  'ia.vek v1.9.47 (0627): a entrega de cada e-mail aceito pela Resend (o webhook atualiza o estado). Só do servidor.';
create index if not exists iavek_entregas_de_email_recurso
  on public.iavek_entregas_de_email (organization_id, tipo, recurso_id, enviado_em desc);

alter table public.iavek_entregas_de_email enable row level security;
revoke all on public.iavek_entregas_de_email from public, anon, authenticated;
grant select, insert, update, delete on public.iavek_entregas_de_email to service_role;

notify pgrst, 'reload schema';
