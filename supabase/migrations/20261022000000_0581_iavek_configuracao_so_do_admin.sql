-- manifest: ia.vek v1.7.6 — configuração é só do admin também no banco: as policies de escrita das tabelas de configuração e as 4 funções que checavam gerente passam a exigir admin; telefones e modelos Meta deixam de aceitar escrita de qualquer membro
--
-- POR QUÊ
--   Decisão do dono do produto (21/10/2026): quem dita a estratégia é o admin;
--   gerente, SDR, suporte e vendedor operam. A API já exige admin nas rotas de
--   configuração (v1.7.6), mas a RLS ainda deixava o gerente gravar direto pelo
--   PostgREST com o próprio login — a chave anon e o JWT dele estão no navegador.
--
-- O QUE MUDA
--   1. Escrita (as policies que NÃO são de leitura) de: funis, etapas,
--      automações, fontes de webhook, tipos de agendamento, conhecimento e FAQ
--      da IA, fluxos de follow-up (ponteiros e versões), inscrições de
--      follow-up, produtos, campanhas (e destinatários, sessões, supressões,
--      modelos), modelos de proposta, integrações, importações. A régua
--      `fn_role_at_least(org, 'manager')` vira `'admin'`. As policies de LEITURA
--      são outras e não mudam: todo membro continua vendo.
--   2. Respostas rápidas: as PRÓPRIAS seguem de cada um (agent+); as padrão da
--      loja (sem dono) passam de gerente para admin.
--   3. Agenda: bloqueios (calendar_availability_exceptions) e endereços
--      (calendar_locations) deixam de aceitar "o próprio usuário" e o gerente:
--      só admin. Os horários (attendant_availability.schedule) ficam só do
--      admin na API — a tabela também guarda a presença de cada atendente.
--   4. FURO: phone_numbers e meta_templates tinham UMA policy FOR ALL só por
--      organização — qualquer membro, até viewer, gravava. Viram leitura para
--      membros + escrita só para admin.
--   5. Funções security definer que checavam gerente por dentro:
--      fn_agenda_settings, fn_set_channel_routing, fn_vocabulario_de_tags_operar
--      e fn_definir_colegas_podem_mexer_na_agenda passam a checar admin.
--
-- COMO (e por que assim)
--   As policies e funções têm expressões longas que já foram reescritas várias
--   vezes no apêndice do baseline. Em vez de copiar cada uma (e arriscar copiar
--   uma versão velha), o bloco lê a definição EM VIGOR no banco e troca só a
--   régua. Idempotente: na segunda aplicação não há mais 'manager' a trocar.
--   Falha alto se a policy/função não existir ou se a régua não for achada nem
--   já trocada — melhor parar o update do que deixar a brecha aberta calado.
--
-- ADITIVA no sentido do rito: nenhuma coluna, tabela ou dado muda; só quem
-- pode escrever. Volta: reaplicar a régua 'manager' (bloco simétrico).

do $iavek_0581$
declare
  alvo record;
  p record;
  nova_using text;
  nova_check text;
  sql text;
begin
  for alvo in
    select * from (values
      ('crm_pipelines', 'crm_pipelines_manager_write'),
      ('crm_stages', 'crm_stages_manager_write'),
      ('automation_rules', 'automation_rules_manager_write'),
      ('webhook_sources', 'webhook_sources_manager_write'),
      ('calendar_event_types', 'calendar_event_types_write'),
      ('ai_knowledge_sources', 'tenant_isolation_ai_knowledge_sources_write'),
      ('ai_faq_items', 'tenant_isolation_ai_faq_items_write'),
      ('followup_flow_pointers', 'followup_flow_pointers_insert'),
      ('followup_flow_pointers', 'followup_flow_pointers_update'),
      ('followup_flow_pointers', 'followup_flow_pointers_delete'),
      ('followup_flow_versions', 'followup_flow_versions_delete'),
      ('followup_enrollments', 'followup_enrollments_insert'),
      ('followup_enrollments', 'followup_enrollments_update'),
      ('followup_enrollments', 'followup_enrollments_delete'),
      ('catalog_products', 'catalog_products_insert'),
      ('catalog_products', 'catalog_products_write'),
      ('catalog_products', 'catalog_products_delete'),
      ('campaigns', 'campaigns_write'),
      ('campaign_channel_sessions', 'campaign_channel_sessions_write'),
      ('campaign_recipients', 'campaign_recipients_write'),
      ('campaign_suppressions', 'campaign_suppressions_write'),
      ('campaign_templates', 'campaign_templates_write'),
      ('proposal_templates', 'proposal_templates_write'),
      ('tenant_integrations', 'tenant_integrations_admin_write'),
      ('import_batches', 'import_batches_insert'),
      ('import_batches', 'import_batches_update'),
      ('import_batches', 'import_batches_delete'),
      ('import_rows', 'import_rows_insert'),
      ('import_rows', 'import_rows_update'),
      ('import_rows', 'import_rows_delete'),
      ('message_templates', 'message_templates_write')
    ) as t(tabela, policy)
  loop
    select * into p from pg_policies
     where schemaname = 'public' and tablename = alvo.tabela and policyname = alvo.policy;
    if not found then
      raise exception 'ia.vek 0581: policy %.% não existe', alvo.tabela, alvo.policy;
    end if;
    nova_using := replace(p.qual, '''manager''::text', '''admin''::text');
    nova_check := replace(p.with_check, '''manager''::text', '''admin''::text');
    if coalesce(nova_using, '') = coalesce(p.qual, '')
       and coalesce(nova_check, '') = coalesce(p.with_check, '') then
      -- Nada a trocar: tem de ser porque já está em admin.
      if coalesce(p.qual, '') || coalesce(p.with_check, '') not like '%''admin''::text%' then
        raise exception 'ia.vek 0581: policy %.% sem régua de papel reconhecível', alvo.tabela, alvo.policy;
      end if;
      continue;
    end if;
    sql := format('alter policy %I on public.%I', alvo.policy, alvo.tabela);
    if nova_using is not null then sql := sql || format(' using (%s)', nova_using); end if;
    if nova_check is not null then sql := sql || format(' with check (%s)', nova_check); end if;
    execute sql;
  end loop;
end
$iavek_0581$;

-- Agenda: bloqueios e endereços só do admin (sem "o próprio usuário").
-- `attendant_availability` NÃO muda aqui: a mesma linha guarda a PRESENÇA do
-- atendente (batida de vida, disponível/indisponível), que cada um grava na
-- própria linha. Os HORÁRIOS (schedule) e a capacidade ficam só do admin pela
-- API (app/api/v1/attendants/availability/[user_id]).
drop policy if exists calendar_availability_exceptions_write on public.calendar_availability_exceptions;
create policy calendar_availability_exceptions_write on public.calendar_availability_exceptions
  for all using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  ) with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  );

drop policy if exists calendar_locations_insert on public.calendar_locations;
create policy calendar_locations_insert on public.calendar_locations
  for insert with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  );

-- FURO: telefones e modelos Meta aceitavam escrita de qualquer membro.
drop policy if exists phone_numbers_isolation on public.phone_numbers;
drop policy if exists phone_numbers_select on public.phone_numbers;
drop policy if exists phone_numbers_admin_write on public.phone_numbers;
create policy phone_numbers_select on public.phone_numbers
  for select using (organization_id in (select public.fn_user_org_ids()));
create policy phone_numbers_admin_write on public.phone_numbers
  for all using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  ) with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  );

drop policy if exists tenant_isolation_meta_templates_all on public.meta_templates;
drop policy if exists meta_templates_select on public.meta_templates;
drop policy if exists meta_templates_admin_write on public.meta_templates;
create policy meta_templates_select on public.meta_templates
  for select using (organization_id in (select public.fn_user_org_ids()));
create policy meta_templates_admin_write on public.meta_templates
  for all using (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  ) with check (
    public.fn_is_platform_admin_full()
    or (organization_id in (select public.fn_user_org_ids())
        and public.fn_role_at_least(organization_id, 'admin'))
  );

-- Funções que checavam gerente por dentro: a mesma definição em vigor, com a
-- régua trocada. Lida do catálogo (não copiada) para não ressuscitar versão velha.
do $iavek_0581_fn$
declare
  f record;
  def text;
  nova text;
  achadas int := 0;
begin
  for f in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_agenda_settings', 'fn_set_channel_routing',
                         'fn_vocabulario_de_tags_operar',
                         'fn_definir_colegas_podem_mexer_na_agenda')
  loop
    def := pg_get_functiondef(f.oid);
    nova := regexp_replace(def, 'fn_role_at_least\((\s*p_org\s*),\s*''manager''\)',
                           'fn_role_at_least(\1, ''admin'')', 'g');
    if nova <> def then
      execute nova;
    elsif def !~ 'fn_role_at_least\(\s*p_org\s*,\s*''admin''\)' then
      raise exception 'ia.vek 0581: % sem régua de gerente reconhecível', f.proname;
    end if;
    achadas := achadas + 1;
  end loop;
  if achadas <> 4 then
    raise exception 'ia.vek 0581: esperava 4 funções de configuração, achei %', achadas;
  end if;
end
$iavek_0581_fn$;
