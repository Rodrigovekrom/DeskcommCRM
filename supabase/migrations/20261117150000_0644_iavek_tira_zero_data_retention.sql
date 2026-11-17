-- manifest: ia.vek v1.9.60 (0644, CRM-489) — sai a chave `zero_data_retention` do agente, que não fazia nada
--
-- POR QUÊ (CÓDIGO, 17/11, CRM-462 L4): `ai_agents.config.zero_data_retention` nasce `false` pelo default da coluna
-- (0097), e NENHUM código a lê (app, lib, workers, components: 0 leitores). Quem a visse ligada acharia que o
-- fornecedor não guarda o dado, e nada mudaria. "Fazer funcionar" não tem efeito real hoje: no caminho do AI Gateway o
-- cabeçalho `X-AI-Gateway-Zero-Retention: 1` já vai SEMPRE (lib/ai/gateway.ts:108), e na chamada direta ao fornecedor
-- não há interruptor por chamada equivalente (a retenção do fornecedor é do contrato da conta). Então a chave sai.
--
-- O QUE MUDA: (1) o default da coluna `ai_agents.config` fica sem a chave (o resto IGUAL ao da 0097); (2) a chave sai
-- das linhas em que vale `false` (o valor de nascença). Linha com `true` NÃO é tocada: alguém a ligou de propósito, e
-- quem decide é quem ligou. Nada mais muda. Volta: voltar-0644.sql (o default de antes e a chave `false` de volta onde
-- falta).

alter table public.ai_agents
  alter column config set default jsonb_build_object(
    'temperature', 0.3, 'max_tokens', 1024, 'rag_top_k', 5,
    'rag_similarity_threshold', 0.40, 'context_message_window', 20,
    'confidence_threshold', 0.55, 'sentiment_threshold', 0.3);

update public.ai_agents
   set config = config - 'zero_data_retention'
 where config ? 'zero_data_retention'
   and config->'zero_data_retention' = 'false'::jsonb;

notify pgrst, 'reload schema';
