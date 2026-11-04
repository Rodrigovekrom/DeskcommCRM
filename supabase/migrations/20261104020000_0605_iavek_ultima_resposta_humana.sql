-- manifest: ia.vek v1.9.18 (0605) — a conversa guarda quando uma PESSOA respondeu pelo sistema (`ultima_resposta_humana_em`): é o que apaga a marca "nova mensagem" no cartão. Resposta de fora do sistema, do outro atendimento automático por exemplo, não apaga.
--
-- ADITIVA: 1 coluna e 1 gatilho. O preenchimento inicial só lê as mensagens enviadas
-- por uma pessoa pelo sistema; nenhuma outra coluna muda.

alter table public.conversations add column if not exists ultima_resposta_humana_em timestamptz;

create or replace function public.fn_iavek_marca_resposta_humana()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'outbound' and new.sent_by_user_id is not null then
    update public.conversations
       set ultima_resposta_humana_em = greatest(coalesce(ultima_resposta_humana_em, new.created_at), new.created_at)
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
  when (new.direction = 'outbound' and new.sent_by_user_id is not null)
  execute function public.fn_iavek_marca_resposta_humana();

update public.conversations c
   set ultima_resposta_humana_em = m.em
  from (select conversation_id, max(created_at) em
          from public.messages
         where direction = 'outbound' and sent_by_user_id is not null
         group by conversation_id) m
 where c.id = m.conversation_id
   and c.ultima_resposta_humana_em is distinct from m.em;
