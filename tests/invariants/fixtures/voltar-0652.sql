-- VOLTA da 0652 (ia.vek CRM-434): tira o aviso "respondeu o seu cliente".
-- Ordem: a imagem anterior PRIMEIRO (a nova mostra a frase do tipo; sem o tipo no banco, nada quebra).
-- O que se PERDE: os avisos 'resposta_de_outro' já gravados (o check de volta não os aceita). Nenhuma mensagem muda.
begin;
drop trigger if exists trg_iavek_avisa_resposta_de_outro on public.messages;
drop function if exists public.fn_iavek_avisa_resposta_de_outro();
delete from public.notificacoes where tipo = 'resposta_de_outro';
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
  'orientacao_da_loja',
  'novidade_da_versao'
));
notify pgrst, 'reload schema';
commit;
