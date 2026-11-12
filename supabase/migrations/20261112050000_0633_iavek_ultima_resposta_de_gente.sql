-- manifest: ia.vek v1.9.50 (0633) — a conversa guarda a última RESPOSTA de verdade ao cliente (`ultima_resposta_em`): pela tela do CRM, pelo celular (e a Venda.IA, que fala pelo celular) ou pela IA do CRM. As mensagens AUTOMÁTICAS do sistema (sent_via 'system'/'automation': lembretes, avisos) NÃO contam, porque ninguém falou com o cliente. É a régua do filtro "Não respondidos" do Pipeline e da marca "sem resposta" do cartão (decisão do Rodrigo, Maestro 211923).
--
-- ADITIVA: 1 coluna. O gatilho da 0605 (trg_iavek_marca_resposta_humana) passa a gravar as DUAS colunas num UPDATE só
-- (nenhum gatilho novo, nenhum UPDATE a mais por mensagem enviada pela tela); ele agora dispara também na mensagem
-- enviada pelo celular (external_device) e pela IA. O `ultima_resposta_humana_em` segue IGUAL (só pessoa pela tela):
-- as não lidas de quem olha continuam lendo dele. O preenchimento inicial só lê as mensagens enviadas.
-- Volta: voltar-0633.sql (o corpo e o gatilho da 0605; a coluna fica, inofensiva).

alter table public.conversations add column if not exists ultima_resposta_em timestamptz;

create or replace function public.fn_iavek_marca_resposta_humana()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_humana boolean := new.sent_by_user_id is not null;
  v_resposta boolean := new.sent_by_user_id is not null or new.sent_via::text in ('user', 'external_device', 'ai');
begin
  if new.direction = 'outbound' and (v_humana or v_resposta) then
    update public.conversations
       set ultima_resposta_humana_em = case when v_humana
             then greatest(coalesce(ultima_resposta_humana_em, new.created_at), new.created_at)
             else ultima_resposta_humana_em end,
           ultima_resposta_em = case when v_resposta
             then greatest(coalesce(ultima_resposta_em, new.created_at), new.created_at)
             else ultima_resposta_em end
     where id = new.conversation_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_marca_resposta_humana() from public, anon, authenticated;

drop trigger if exists trg_iavek_marca_resposta_humana on public.messages;
create trigger trg_iavek_marca_resposta_humana
  after insert on public.messages
  for each row
  when (new.direction = 'outbound' and (new.sent_by_user_id is not null or new.sent_via::text in ('user', 'external_device', 'ai')))
  execute function public.fn_iavek_marca_resposta_humana();

update public.conversations c
   set ultima_resposta_em = m.em
  from (select conversation_id, max(created_at) em
          from public.messages
         where direction = 'outbound'
           and (sent_by_user_id is not null or sent_via::text in ('user', 'external_device', 'ai'))
         group by conversation_id) m
 where c.id = m.conversation_id
   and c.ultima_resposta_em is distinct from m.em;
