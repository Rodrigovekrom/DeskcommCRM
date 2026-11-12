-- manifest: ia.vek v1.9.48 (0629) — o sino ganha o aviso 'agendamento_no_seu_lead': quem agenda no lead de OUTRA pessoa da loja não tira o lead do dono, e o dono é avisado
--
-- POR QUÊ: decisão do Rodrigo (Notion, 12/11 12:48Z, via Maestro 125050): "qualquer um que está usando o CRM precisa
-- conseguir agendar sem nenhuma trava". Agendar no lead de outra pessoa passa, o lead NÃO muda de dono, e o dono recebe
-- "Fulano agendou ... no seu lead". O sino só aceita os tipos da lista: este é o tipo novo.
-- O QUE MUDA: só a lista de tipos de notificacoes (a de hoje + 1). Nenhuma linha muda.
-- Idempotente. Volta: voltar-0629.sql (a lista de antes, NOT VALID: os avisos já gravados ficam).

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
  'ia_travou',
  -- ia.vek v1.9.48 (migration 0629): alguém da loja agendou no lead de OUTRA pessoa; o dono é avisado.
  'agendamento_no_seu_lead'
));

notify pgrst, 'reload schema';
