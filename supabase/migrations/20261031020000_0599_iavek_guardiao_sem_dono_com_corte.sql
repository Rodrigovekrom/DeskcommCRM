-- manifest: ia.vek v1.9.9-seg (0599) — data de corte dos leads SEM dono para o guardião: com `settings.iavek.guardiao_ve_sem_dono_desde`, o guardião vê só os sem dono criados a partir dela (os antigos ficam com Suporte IA, gerência e admin)
--
-- O PEDIDO (dono do produto, 31/10)
--   Os ~600 leads abertos sem dono que vieram do sistema anterior ficam SÓ no
--   atendimento da IA (Suporte IA, gerência, admin) até se descobrir, no sistema
--   anterior, quem é o responsável de cada um. Os leads NOVOS sem dono continuam
--   na fila do guardião.
--
-- A REGRA
--   Com a chave `settings.iavek.guardiao_ve_sem_dono_desde` (instante ISO-8601)
--   gravada na organização, o agente com função "sdr" (guardião) enxerga os
--   leads sem dono criados a partir desse instante. Sem a chave: nada muda (a
--   regra da 0598 inteira). A chave `guardiao_ve_sem_dono = false` continua
--   valendo e vence (o guardião não vê sem dono nenhum).
--   NÃO muda: o que o guardião é dono ou guardião; vendedor, Suporte IA,
--   gerência e admin; as CONVERSAS (cortá-las esconderia a conversa de um
--   contato antigo que gerou lead novo).
--
-- DESEMPENHO
--   A primeira forma (função que devolvia TABELA, num `not exists` correlacionado)
--   rodava a função de novo a cada lead sem dono — medido com EXPLAIN no banco de
--   teste: `loops=5`, 0,3 ms cada; com ~600 sem dono, ~180 ms a mais por leitura
--   do guardião. Agora ela devolve um MAPA jsonb lido uma vez por consulta
--   (initplan) e a policy só consulta o mapa por linha.
--
-- ADITIVA: uma função nova e a policy de SELECT de leads trocada no lugar.
-- Nenhum dado muda (quem grava a chave é o script de aplicação, à parte).

-- A policy de SELECT é derrubada ANTES da função: ela depende da função, e uma
-- versão anterior desta (só no banco de teste) devolvia tabela, não jsonb.
drop policy if exists "crm_leads_select" on public.crm_leads;
drop function if exists public.fn_iavek_corte_sem_dono();

-- O mapa { organização: corte } das organizações em que quem chama é GUARDIÃO
-- (agente com função "sdr") com a chave gravada. Um valor só por consulta: a
-- policy o lê como `(select ...)` (initplan) e só consulta o mapa por linha.
create or replace function public.fn_iavek_corte_sem_dono()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(o.id::text, o.settings->'iavek'->>'guardiao_ve_sem_dono_desde'), '{}'::jsonb)
    from public.organizations o
    join public.user_organizations uo
      on uo.organization_id = o.id
     and uo.user_id = auth.uid()
     and uo.revoked_at is null
     and uo.role = 'agent'
     and uo.interface_settings->>'funcao' = 'sdr'
   where o.id in (select public.fn_user_org_ids())
     and (o.settings->'iavek'->>'guardiao_ve_sem_dono_desde') ~ '^\d{4}-\d{2}-\d{2}T';
$$;
revoke execute on function public.fn_iavek_corte_sem_dono() from public, anon;
grant execute on function public.fn_iavek_corte_sem_dono() to authenticated, service_role;

create policy "crm_leads_select" on public.crm_leads
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_tudo)
    or (owner_user_id = (select auth.uid())
        and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v))
    or (owner_user_id is null
        and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_sem_dono)
        -- 0599: o guardião com data de corte vê só os sem dono criados a partir dela.
        and created_at >= coalesce(((select public.fn_iavek_corte_sem_dono()) ->> organization_id::text)::timestamptz,
                                   '-infinity'::timestamptz))
    or (sdr_user_id = (select auth.uid())
        and organization_id in (select public.fn_user_org_ids()))
  );
