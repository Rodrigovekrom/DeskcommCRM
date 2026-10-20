-- manifest: ia.vek v1.7.4 — conversations_select decide "quem sou e o que vejo" UMA vez por consulta (initplan), não por linha: a lista de conversas do vendedor caiu de ~590 ms para ~10 ms com o mesmo conjunto visível
--
-- O PROBLEMA (medido na produção em 20/10/2026, só leitura)
--   A policy chamava, POR LINHA, `fn_can_view_conversation(org, dono)` — que
--   consulta o papel duas vezes (fn_user_role_in_org → fn_support_context) — e
--   `fn_iavek_e_guardiao_do_contato(org, contato)` (0579). Nenhuma das duas pode
--   ser embutida pelo planejador (security definer com search_path), então o
--   custo é ~3 ms × conversas. Vendedor: 590 ms para 198 conversas; admin: 22 ms.
--   `messages_select` e as policies de notas, rascunhos e passagens fazem
--   `exists (select 1 from conversations ...)`, então herdam o mesmo custo.
--
-- A CORREÇÃO
--   A mesma regra, escrita para o Postgres avaliar o que NÃO depende da linha
--   uma vez só por consulta: `(select ...)` vira initplan, e `org in (select ...)`
--   vira hash. Duas funções novas devolvem CONJUNTOS (e não sim/não por linha):
--     · fn_iavek_visao_de_conversas(): as organizações de quem chama, com o que o
--       papel e a visibility_mode da organização deixam ver (tudo / sem dono);
--     · fn_iavek_contatos_que_guardo(): os contatos de que quem chama é o SDR
--       guardião (0579).
--   A regra é a de `fn_can_view_conversation`, caso a caso:
--     admin de plataforma → tudo; sem papel na org → nada; viewer/manager/admin →
--     tudo; dono da conversa → a dele; visibility_mode 'all' → tudo;
--     'own_and_unassigned' (padrão) → as sem dono; guardião → as do contato.
--   Medido com a expressão equivalente, na produção, só leitura: o conjunto
--   visível é IDÊNTICO (mesma assinatura dos ids) para vendedor e admin.
--
-- ADITIVA: duas funções novas e a policy trocada no lugar. `fn_can_view_conversation`
-- e `fn_iavek_e_guardiao_do_contato` continuam existindo (outras policies usam a
-- primeira). Nenhum dado muda. No baseline, a policy mora no lugar da original
-- (cerca baseline-nao-constroi-o-que-derruba).

create or replace function public.fn_iavek_visao_de_conversas()
returns table (org_id uuid, ve_tudo boolean, ve_sem_dono boolean)
language sql
stable
security definer
set search_path = public
as $$
  select v.org,
         v.papel in ('viewer', 'manager', 'admin') or v.modo = 'all',
         v.modo = 'own_and_unassigned'
    from (
      select x.org,
             public.fn_user_role_in_org(x.org) as papel,
             coalesce((select o.settings->>'visibility_mode'
                         from public.organizations o
                        where o.id = x.org), 'own_and_unassigned') as modo
        from public.fn_user_org_ids() as x(org)
    ) v
   where v.papel is not null;
$$;
revoke execute on function public.fn_iavek_visao_de_conversas() from public, anon;
grant execute on function public.fn_iavek_visao_de_conversas() to authenticated, service_role;

-- plpgsql de propósito, como a 0579: o corpo só é resolvido na chamada.
create or replace function public.fn_iavek_contatos_que_guardo()
returns table (org_id uuid, contato_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select l.organization_id, l.contact_id
      from public.crm_leads l
     where l.sdr_user_id = auth.uid()
       and l.contact_id is not null
       and l.organization_id in (select public.fn_user_org_ids());
end;
$$;
revoke execute on function public.fn_iavek_contatos_que_guardo() from public, anon;
grant execute on function public.fn_iavek_contatos_que_guardo() to authenticated, service_role;

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_tudo)
    or (assigned_to_user_id = (select auth.uid())
        and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v))
    or (assigned_to_user_id is null
        and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_sem_dono))
    or (organization_id, contact_id) in (select g.org_id, g.contato_id from public.fn_iavek_contatos_que_guardo() g)
  );
