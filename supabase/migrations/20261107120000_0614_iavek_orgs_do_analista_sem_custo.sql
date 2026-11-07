-- manifest: ia.vek v1.9.36 (0614, CRM-260) — a policy `orgs_select_analista_de_ficha` (0586) lê o vínculo do analista por uma função security definer, em vez de uma subconsulta em user_organizations que passava pela RLS dessa tabela; mesma regra, sem o custo em todo pedido
--
-- POR QUÊ (medido no banco de TESTE, 07/11/2026; produção com o mesmo padrão no pg_stat_statements):
--   A subconsulta da 0586 em `user_organizations` passava pela RLS dessa tabela: varredura inteira e
--   `fn_role_at_least` em cada linha. Custava ~55 ms cada vez, e TODA leitura de `organizations` a paga:
--   a conferência de quem está logado (lib/auth/server.ts, em todo pedido de tela) duas vezes, ~117 ms;
--   `fn_iavek_modo_agendamento` (security invoker) e, através dela, a policy de escrita da agenda, que
--   vale também para a leitura (radar de risco: 396 ms por lote de 100 contatos).
--   Com a função abaixo: 117 ms → 2,7 ms; 396 ms → 60 ms.
--
-- A REGRA NÃO MUDA: o analista (função `analista_ficha`, vínculo não revogado) vê a linha da própria
-- organização, e mais ninguém ganha nada — a função só devolve organizações em que QUEM CHAMA
-- (`auth.uid()`) é analista. É o molde de `fn_iavek_orgs_onde_sou_vendedor` (0607). Sem SQL dinâmico,
-- STABLE, search_path fixo; EXECUTE só para authenticated e service_role (nunca anon/PUBLIC).
--
-- Idempotente (create or replace; drop policy if exists). Volta: voltar-0614.sql (recria a policy da 0586
-- e remove a função).

create or replace function public.fn_iavek_orgs_onde_sou_analista()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select uo.organization_id
    from public.user_organizations uo
   where uo.user_id = auth.uid()
     and uo.revoked_at is null
     and uo.interface_settings->>'funcao' = 'analista_ficha';
$$;
revoke execute on function public.fn_iavek_orgs_onde_sou_analista() from public, anon;
grant execute on function public.fn_iavek_orgs_onde_sou_analista() to authenticated, service_role;

drop policy if exists orgs_select_analista_de_ficha on public.organizations;
create policy orgs_select_analista_de_ficha on public.organizations
  for select using (
    id in (select public.fn_iavek_orgs_onde_sou_analista())
  );
