-- manifest: ia.vek v1.9.43 (0616, P3 da Lupa) — `fn_iavek_mesclar_source_metadata`: grava chaves no `crm_leads.source_metadata` com `||` NO BANCO, sem ler-e-regravar o objeto inteiro (perda_observacao do Perdido e iavek_carro_desfecho do nascimento)
--
-- POR QUÊ: as duas escritas liam o source_metadata, juntavam a chave no app e regravavam o objeto
-- inteiro. Uma escrita concorrente no meio (o WhatsApp gravando waha_lid, a atribuição do anúncio)
-- era APAGADA. Com `coalesce(source_metadata, '{}') || p_patch` a mesclagem é uma instrução só,
-- sob o lock de linha do UPDATE: o que outro gravou nas outras chaves fica.
--
-- SECURITY INVOKER de propósito: roda com o RLS de quem chama. O Perdido chama com o cliente do
-- usuário (o mesmo que já podia dar UPDATE no lead), o nascimento com o service role. A função não
-- abre nada que o UPDATE direto já não permitisse. `organization_id = p_org` no where: lead de outra
-- organização casa zero linhas. Só aceita objeto (um array ou escalar viraria lixo no ||).
-- Aditiva e idempotente (create or replace). Nenhuma linha muda ao aplicar.
-- Volta: voltar-0616.sql (drop function).

create or replace function public.fn_iavek_mesclar_source_metadata(p_org uuid, p_lead uuid, p_patch jsonb)
returns boolean
language sql
security invoker
set search_path = public
as $$
  with u as (
    update public.crm_leads
       set source_metadata = coalesce(source_metadata, '{}'::jsonb) || p_patch
     where id = p_lead
       and organization_id = p_org
       and jsonb_typeof(p_patch) = 'object'
    returning 1
  )
  select exists (select 1 from u);
$$;

revoke all on function public.fn_iavek_mesclar_source_metadata(uuid, uuid, jsonb) from public, anon;
grant execute on function public.fn_iavek_mesclar_source_metadata(uuid, uuid, jsonb) to authenticated, service_role;

comment on function public.fn_iavek_mesclar_source_metadata(uuid, uuid, jsonb) is
  'ia.vek v1.9.43 (0616): source_metadata = coalesce(source_metadata, {}) || p_patch, numa instrução só (sem ler-e-regravar). SECURITY INVOKER: vale o RLS de quem chama. Devolve true se o lead (da organização) foi atualizado.';

notify pgrst, 'reload schema';
