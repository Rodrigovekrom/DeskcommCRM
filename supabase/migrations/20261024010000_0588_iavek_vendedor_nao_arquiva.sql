-- manifest: ia.vek v1.8.2 — vendedor (papel agent) NÃO arquiva conversa: gatilho recusa status='archived' vindo de sessão abaixo de gerente, inclusive pela REST direta (a policy de update da conversa é de agent)
--
-- POR QUÊ (decisão do Rodrigo, 24/10/2026): para tirar o lead da fila o
-- vendedor MOVE o lead para uma etapa (Não responde, Muito longe, Perdido);
-- arquivar a conversa é de gerente e admin.
--
-- A rota PATCH /api/v1/conversations/:id já exige gerente para "archived" e o
-- botão já some para o vendedor. Faltava o banco: a policy
-- `conversations_agent_update` deixa qualquer agent gravar a linha, então o
-- vendedor com o próprio JWT arquivava pela REST sem passar pela rota.
--
-- O gatilho só olha SESSÃO de usuário (auth.uid() não nulo): service_role,
-- crons e workers seguem iguais. Super-admin com acesso pleno passa.
-- ADITIVA: só função e gatilho novos; nenhum dado muda.

create or replace function public.fn_iavek_so_gerente_arquiva()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'archived'
     and old.status is distinct from 'archived'
     and auth.uid() is not null
     and not public.fn_is_platform_admin_full()
     and not public.fn_role_at_least(new.organization_id, 'manager') then
    raise exception 'Só gerente ou admin arquiva conversa. Para tirar o lead da fila, mova-o para uma etapa.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.fn_iavek_so_gerente_arquiva() from public, anon;
grant execute on function public.fn_iavek_so_gerente_arquiva() to authenticated, service_role;

drop trigger if exists trg_iavek_so_gerente_arquiva on public.conversations;
create trigger trg_iavek_so_gerente_arquiva
  before update of status on public.conversations
  for each row execute function public.fn_iavek_so_gerente_arquiva();
