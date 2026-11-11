-- manifest: ia.vek v1.9.44 (0617, Lupa) — `fn_iavek_ultima_atribuicao`: a ÚLTIMA atribuição de cada atendente (distinct on to_user_id), para o rodízio, numa resposta de no máximo uma linha por atendente
--
-- POR QUÊ: o rodízio (lib/routing/eligibles.ts) lia TODOS os eventos de atribuição dos atendentes,
-- do mais novo para o mais velho, e ficava com o primeiro de cada um. Acima do corte do servidor
-- (3.000 linhas na produção), quem recebeu pela última vez antes dos 3.000 eventos mais recentes
-- voltava como "nunca recebeu" e furava a fila do rodízio. Medido em 11/11: 310 eventos, longe do
-- corte; é a mesma classe de defeito. Com `distinct on (to_user_id)` a resposta tem no máximo uma
-- linha por atendente pedido.
--
-- SECURITY INVOKER: vale o RLS de quem chama (o worker passa o admin; nada além do SELECT que já
-- existia). STABLE. Filtra a organização em `e.organization_id` e, no escopo de canal, também em
-- `c.organization_id` e `c.channel_session_id`, como o `conversations!inner(...)` fazia.
-- Aditiva e idempotente (create or replace). Nenhuma linha muda ao aplicar.
-- Volta: voltar-0617.sql (drop function).

create or replace function public.fn_iavek_ultima_atribuicao(
  p_org uuid,
  p_users uuid[],
  p_channel_session uuid default null
)
returns table (to_user_id uuid, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (e.to_user_id) e.to_user_id, e.created_at
    from public.conversation_assignment_events e
    join public.conversations c on c.id = e.conversation_id
   where e.organization_id = p_org
     and e.to_user_id = any (p_users)
     and (
       p_channel_session is null
       or (c.organization_id = p_org and c.channel_session_id = p_channel_session)
     )
   order by e.to_user_id, e.created_at desc;
$$;

revoke all on function public.fn_iavek_ultima_atribuicao(uuid, uuid[], uuid) from public, anon;
grant execute on function public.fn_iavek_ultima_atribuicao(uuid, uuid[], uuid) to authenticated, service_role;

comment on function public.fn_iavek_ultima_atribuicao(uuid, uuid[], uuid) is
  'ia.vek v1.9.44 (0617): a última atribuição de cada atendente (distinct on to_user_id) para o rodízio. SECURITY INVOKER. No escopo de canal, só as conversas daquele canal.';

notify pgrst, 'reload schema';
