-- manifest: ia.vek v1.9.60 (0642, CRM-484) — o painel de admin da plataforma lê o gasto de IA DO MÊS pela régua única
--
-- POR QUÊ (MEDIDO 17/11, CRM-483): o painel (app/api/v1/admin/dashboard/kpis) lia ai_budgets.current_month_consumed_cents,
-- o contador do gatilho fn_update_budget_consumption que soma sem olhar a data e nunca zera. Na Fenômenos ele marcava
-- 916,58 centavos (todo o gasto de outubro) com o gasto do mês em 0,00. A régua que DECIDE é fn_gasto_de_ia_do_mes (0159);
-- o próprio painel já pedia a variante em lote dela.
--
-- O QUE MUDA: só uma função nova, fn_gasto_de_ia_do_mes_em_lote(uuid[]), que CHAMA a régua para cada organização (não
-- é uma segunda régua: a soma continua só dentro de fn_gasto_de_ia_do_mes). O contador ai_budgets fica como está (o
-- gatilho e as linhas não mudam). security invoker e os mesmos revokes da régua (0159): recebe as organizações por
-- argumento e não valida membership. ADITIVA. Volta: voltar-0642.sql (drop function).

create or replace function public.fn_gasto_de_ia_do_mes_em_lote(p_orgs uuid[])
returns table (organization_id uuid, gasto numeric)
  language sql
  stable
  security invoker
  set search_path to 'public', 'pg_temp'
as $$
  select o, public.fn_gasto_de_ia_do_mes(o)
    from unnest(coalesce(p_orgs, '{}'::uuid[])) as o;
$$;

comment on function public.fn_gasto_de_ia_do_mes_em_lote(uuid[]) is
  'ia.vek 0642 (v1.9.60, CRM-484): o gasto de IA do MÊS de várias organizações de uma vez, chamando fn_gasto_de_ia_do_mes para cada uma (a régua única, em centavos de DÓLAR). Usada pelo painel de admin da plataforma no lugar de ai_budgets.current_month_consumed_cents, que não zera no mês. security invoker, só service_role.';

revoke execute on function public.fn_gasto_de_ia_do_mes_em_lote(uuid[])
  from public, anon, authenticated;
grant  execute on function public.fn_gasto_de_ia_do_mes_em_lote(uuid[])
  to service_role;

notify pgrst, 'reload schema';
