-- manifest: ia.vek v1.7.6 — proposta do vendedor passa pela aprovação do gerente: status 'aguardando_aprovacao', quem pediu e quando, devolução com motivo; e os avisos do sino para aprovação de proposta e pedido de agendamento
--
-- POR QUÊ
--   Decisão do dono do produto (21/10/2026): o vendedor cria a proposta do
--   PRÓPRIO lead, mas ela só vai ao cliente depois do OK do gerente (ou do
--   admin). Aprovar e devolver é controle da operação, e fica com o gerente.
--
-- O FLUXO (o envio que já existe é o "aprovar e enviar")
--   rascunho ──(vendedor: pedir aprovação)──▶ aguardando_aprovacao
--   aguardando_aprovacao ──(gerente/admin: aprovar e enviar)──▶ enviando ▶ enviada
--   aguardando_aprovacao ──(gerente/admin: devolver, com motivo)──▶ rascunho
--   Enquanto aguarda, a proposta não é editável: o gatilho
--   fn_crm_proposals_transicao_da_sessao já recusa qualquer escrita de sessão
--   fora de rascunho → rascunho. As transições acima são do SERVIDOR (service
--   role, como o envio), que filtra organization_id à mão.
--
-- ADITIVA: um valor a mais no CHECK de status, cinco colunas novas (todas
-- nulas) e seis tipos a mais no CHECK do sino. Nenhum dado muda.

alter table public.crm_proposals drop constraint if exists crm_proposals_status_check;
alter table public.crm_proposals add constraint crm_proposals_status_check
  check (status in ('rascunho','aguardando_aprovacao','enviando','enviada','aceita',
                    'recusada','vencida','cancelada','substituida'));

alter table public.crm_proposals add column if not exists aprovacao_pedida_em timestamptz;
alter table public.crm_proposals add column if not exists aprovacao_pedida_por uuid
  references auth.users(id) on delete set null;
alter table public.crm_proposals add column if not exists devolvida_em timestamptz;
alter table public.crm_proposals add column if not exists devolvida_por uuid
  references auth.users(id) on delete set null;
alter table public.crm_proposals add column if not exists devolucao_motivo text;

-- O bloco do Meu dia do gerente lista as que aguardam, por organização.
create index if not exists crm_proposals_aguardando_aprovacao_idx
  on public.crm_proposals (organization_id, aprovacao_pedida_em)
  where status = 'aguardando_aprovacao';

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
  'pedido_de_agendamento_recusado'
));
