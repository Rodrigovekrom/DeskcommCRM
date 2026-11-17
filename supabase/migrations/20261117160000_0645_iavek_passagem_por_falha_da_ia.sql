-- manifest: ia.vek v1.9.60 (0645, CRM-460) — a passagem para uma pessoa quando o turno da IA MORRE ganha origem e motivo próprios
--
-- POR QUÊ (CÓDIGO, 17/11): o job do turno da IA (inbound_turn, followup_turn, case_reply_turn) que esgota as tentativas
-- vira 'dead' (lib/agent-engine/queue/queue.ts, failJob) com um aviso crítico na Central, e a conversa fica COM A IA:
-- o cliente que escreveu fica sem resposta e ninguém assume. A v1.9.60 passa a conversa para a fila humana nesse caso
-- (lib/agent-engine/agent/passagem-por-falha.ts), e a linha de passagens_de_atendimento precisa dizer POR ONDE e POR QUE.
--
-- O QUE MUDA: só os dois CHECKs de vocabulário fechado, reconstruídos com a lista INTEIRA (a última definição é a que
-- vale; lista incompleta seria remoção silenciosa) + 'falha_da_ia' em origem e em motivo_codigo. Nenhuma linha muda.
-- Volta: voltar-0645.sql (os CHECKs de antes; falha se já houver linha com 'falha_da_ia', de propósito).

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_origem_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_origem_check
  check (origem in (
    'pedido_explicito','opt_out_provavel','ferramenta_do_modelo',
    'teto_de_gasto','caso_escalado','sentimento','legado_pedido',
    'legado_juridico','legado_etapa','legado_confianca','legado_teto',
    'mcp_externo','runtime_nativo','falha_da_ia'));

alter table public.passagens_de_atendimento
  drop constraint if exists passagens_de_atendimento_motivo_codigo_check;
alter table public.passagens_de_atendimento
  add constraint passagens_de_atendimento_motivo_codigo_check
  check (motivo_codigo in (
    'requested_human','suspected_optout','orcamento_de_ia','low_sentiment',
    'low_confidence','critical_stage','legal_mention','refund_mention',
    'caso_escalado','falha_da_ia'));

notify pgrst, 'reload schema';
