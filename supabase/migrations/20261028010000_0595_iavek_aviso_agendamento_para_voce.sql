-- manifest: ia.vek v1.9.3 — o sino ganha o aviso 'agendamento_para_voce': na loja o SDR marca direto para o vendedor escolhido (decisão do Rodrigo, 27/10) e o vendedor é avisado na hora. Só alarga o CHECK de notificacoes.tipo; nenhum dado muda.
--
-- POR QUÊ (CRM-208, 27/10/2026): até a v1.9.2 o SDR só PEDIA o agendamento e o
-- admin confirmava (0583). Agora o SDR da loja marca e escolhe o vendedor; o
-- compromisso nasce confirmado, e o vendedor precisa saber na hora — pelo sino
-- (`notificacoes`, 0579). Os outros papéis seguem pedindo.
--
-- Aditiva: o CHECK só ganha um valor; toda linha que valia continua valendo.
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
  'agendamento_para_voce'
));
