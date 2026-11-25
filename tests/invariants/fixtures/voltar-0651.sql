-- VOLTA da 0651 (ia.vek CRM-439 fase 1): tira as orientações da loja e as novidades da versão.
-- Ordem: a imagem anterior PRIMEIRO (a nova lê e grava estas tabelas; sem elas, a tela do Manual e o bloco do Meu dia
-- dão erro, e o resto do CRM segue).
-- O que se PERDE: as orientações enviadas, o retrato de quem recebeu e os "li e entendi" (o DROP não passa pelos gatilhos
-- de "não apaga", que são por linha). Os avisos do sino dos 2 tipos são apagados, porque apontam para comunicados que
-- deixam de existir e o check da 0629 não os aceita. Nenhuma outra linha muda.
begin;
drop function if exists public.fn_iavek_enviar_comunicado(uuid, text, text, text, text, text, uuid, boolean, uuid, uuid, text);
drop function if exists public.fn_iavek_li_e_entendi(uuid);
-- As 3 num DROP só: a policy de iavek_comunicados lê iavek_comunicados_destinatarios, e a FK desta aponta para aquela;
-- em DROPs separados um sempre trava no outro (medido no teste da volta, 23/11).
drop table if exists public.iavek_comunicados_lidos, public.iavek_comunicados_destinatarios, public.iavek_comunicados;
drop function if exists public.fn_iavek_comunicado_nao_edita();
drop function if exists public.fn_iavek_comunicado_nao_apaga();
drop function if exists public.fn_iavek_comunicado_registro_fixo();
delete from public.notificacoes where tipo in ('orientacao_da_loja', 'novidade_da_versao');
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
  'agendamento_no_seu_lead'
));
notify pgrst, 'reload schema';
commit;
