-- manifest: ia.vek v1.9.9-seg — "cada um vê o seu lead": a visibilidade de leads e conversas passa a conhecer a FUNÇÃO do membro (vendedor só o dele; guardião o dele e o que passou, os sem dono por chave da loja; Suporte IA o dela e o sem dono humano), travas de guardião/contato no lead e de responsável na conversa, apagar conversa só gerente+, buckets lgpd-exports e ai-policy fechados
--
-- O PROBLEMA (medido na produção em 31/10/2026, só leitura)
--   Nenhuma organização grava `settings.visibility_mode`; o padrão é
--   'own_and_unassigned'. Com ele, TODO agente vê o próprio lead e todo lead sem
--   dono — na loja com funções, 579 leads abertos sem dono. Os vendedores viam a
--   loja inteira (conferido pelo dono do produto no computador deles).
--
-- A REGRA (decisão do dono do produto, 31/10)
--   · gerente e admin (e viewer): tudo — como sempre;
--   · agente com função "vendedor": só os leads de que é dono;
--   · agente com função "sdr" (guardião): os de que é dono e os que passou
--     (`sdr_user_id`, policy da 0579); os SEM dono só enquanto a chave da loja
--     `settings.iavek.guardiao_ve_sem_dono` não for `false` (padrão: ligada —
--     hoje é o guardião quem pega os sem dono; a loja desliga quando o Suporte IA
--     assumir);
--   · agente com função "suporte" (Suporte IA): os dela e os sem dono humano
--     (os da IA e os de ninguém). Passou adiante, deixa de ver;
--   · agente SEM função (toda loja que não usa as funções): o `visibility_mode`
--     da organização, como hoje. NADA muda para elas.
--   As conversas seguem a mesma regra (e as mensagens seguem as conversas).
--
-- AS TRAVAS (auditoria de 31/10)
--   · crm_leads: a SESSÃO de um agente não grava guardião nem troca o contato do
--     lead à vontade. Sem isso, um agente se gravava guardião de qualquer contato
--     e lia as conversas dele (`fn_iavek_contatos_que_guardo`).
--   · conversations: o novo responsável tem de ser membro ATIVO (agent+) da
--     organização; o gatilho da 0579 move os leads junto e não conferia.
--   · conversations: apagar passa a ser de gerente+ (o vendedor contornava a 0588).
--   · storage: `lgpd-exports` só admin lê; `ai-policy` só gerente+ escreve. O app
--     usa a chave de serviço nos dois; a sessão não precisava de mais.
--
-- ADITIVA: funções trocadas no lugar com a MESMA assinatura, policies trocadas
-- no lugar, gatilhos novos. Nenhum dado muda.

-- ---- 1. a função do membro e o modo de visibilidade que ela impõe ----
create or replace function public.fn_iavek_funcao_na_org(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case uo.interface_settings->>'funcao' when 'apoio' then 'gerente' else uo.interface_settings->>'funcao' end
    from public.user_organizations uo
   where uo.organization_id = p_org
     and uo.user_id = auth.uid()
     and uo.revoked_at is null
   limit 1;
$$;
revoke execute on function public.fn_iavek_funcao_na_org(uuid) from public, anon;
grant execute on function public.fn_iavek_funcao_na_org(uuid) to authenticated, service_role;

-- O modo que a FUNÇÃO impõe ao agente, ou null (sem função: vale o da organização).
create or replace function public.fn_iavek_modo_da_funcao(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case public.fn_iavek_funcao_na_org(p_org)
    when 'vendedor' then 'own'
    when 'suporte' then 'own_and_unassigned'
    when 'sdr' then
      case when coalesce((select o.settings->'iavek'->>'guardiao_ve_sem_dono'
                            from public.organizations o where o.id = p_org), 'true') = 'false'
           then 'own' else 'own_and_unassigned' end
    else null
  end;
$$;
revoke execute on function public.fn_iavek_modo_da_funcao(uuid) from public, anon;
grant execute on function public.fn_iavek_modo_da_funcao(uuid) to authenticated, service_role;

-- ---- 2. a regra por linha (as policies de insert/update/delete e outras tabelas) ----
create or replace function public.fn_can_view_lead(
  p_org uuid,
  p_owner_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.fn_is_platform_admin() then true
    when public.fn_user_role_in_org(p_org) is null then false
    when public.fn_user_role_in_org(p_org) in ('viewer','manager','admin') then true
    when p_owner_user_id = auth.uid() then true
    else case coalesce(
           public.fn_iavek_modo_da_funcao(p_org),
           (select settings->>'visibility_mode' from public.organizations where id = p_org),
           'own_and_unassigned')
         when 'all' then true
         when 'own_and_unassigned' then p_owner_user_id is null
         else false
       end
  end;
$$;

create or replace function public.fn_can_view_conversation(
  p_org uuid,
  p_assigned_to_user_id uuid
) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when public.fn_is_platform_admin() then true
    when public.fn_user_role_in_org(p_org) is null then false
    when public.fn_user_role_in_org(p_org) in ('viewer','manager','admin') then true
    when p_assigned_to_user_id = auth.uid() then true
    else case coalesce(
           public.fn_iavek_modo_da_funcao(p_org),
           (select settings->>'visibility_mode' from public.organizations where id = p_org),
           'own_and_unassigned')
         when 'all' then true
         when 'own_and_unassigned' then p_assigned_to_user_id is null
         else false
       end
  end;
$$;

-- ---- 3. a regra por CONSULTA (0580): uma vez por consulta, não por linha ----
-- A papel e a função não dependem da linha; o Postgres avalia o conjunto uma vez.
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
             coalesce(public.fn_iavek_modo_da_funcao(x.org),
                      (select o.settings->>'visibility_mode'
                         from public.organizations o
                        where o.id = x.org), 'own_and_unassigned') as modo
        from public.fn_user_org_ids() as x(org)
    ) v
   where v.papel is not null;
$$;

-- O SELECT de leads no mesmo estilo (era fn_can_view_lead POR LINHA). A regra é
-- a mesma das conversas, com o dono do lead no lugar do responsável da conversa;
-- e o guardião continua vendo o que passou (0579).
drop policy if exists "crm_leads_select" on public.crm_leads;
create policy "crm_leads_select" on public.crm_leads
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_tudo)
    or (owner_user_id = (select auth.uid())
        and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v))
    or (owner_user_id is null
        and organization_id in (select v.org_id from public.fn_iavek_visao_de_conversas() v where v.ve_sem_dono))
    or (sdr_user_id = (select auth.uid())
        and organization_id in (select public.fn_user_org_ids()))
  );

-- ---- 4. trava: guardião e contato do lead ----
-- Só a gerência (ou o próprio sistema: gatilho dentro de gatilho, ou a chave de
-- serviço, sem sessão) muda `sdr_user_id` e `contact_id` livremente. O agente:
--   · vira guardião só do lead que ERA dele (a passagem: ele passa o próprio lead);
--   · pode deixar de ser guardião;
--   · herda o guardião do lead de origem num clone (0579, item 9);
--   · aceita a regra da 0579 (o dono anterior vira guardião na troca de dono).
-- O nome começa com "zz" para rodar DEPOIS dos gatilhos da 0579 e ver o valor final.
create or replace function public.fn_iavek_trava_guardiao_do_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eu uuid := auth.uid();
  v_origem uuid;
begin
  if v_eu is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if public.fn_is_platform_admin_full() or public.fn_role_at_least(new.organization_id, 'manager') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.contact_id is distinct from old.contact_id then
      raise exception 'só a gerência troca o contato de um lead'
        using errcode = '42501';
    end if;
    if new.sdr_user_id is distinct from old.sdr_user_id
       -- `is not distinct from` em tudo: com `=`, um dono anterior NULO deixava a
       -- condição inteira nula, o `not` também, e o `if` não disparava (medido:
       -- o guardião se gravava guardião de um lead sem dono).
       and not (
         (new.sdr_user_id is null and old.sdr_user_id is not distinct from v_eu)
         or (new.sdr_user_id is not distinct from v_eu and old.owner_user_id is not distinct from v_eu)
         or (old.sdr_user_id is null and new.sdr_user_id is not null
             and new.sdr_user_id is not distinct from old.owner_user_id
             and new.owner_user_id is distinct from old.owner_user_id)
       )
    then
      raise exception 'só a gerência muda o guardião de um lead'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT: guardião só o herdado de um clone (o lead de origem tem o mesmo).
  if new.sdr_user_id is not null then
    if new.source_metadata ? 'clonado_de'
       and (new.source_metadata->'clonado_de'->>'lead_id') ~* '^[0-9a-f-]{36}$' then
      v_origem := (new.source_metadata->'clonado_de'->>'lead_id')::uuid;
    end if;
    if v_origem is null or not exists (
         select 1 from public.crm_leads l
          where l.id = v_origem
            and l.organization_id = new.organization_id
            and l.sdr_user_id = new.sdr_user_id)
    then
      raise exception 'só a gerência grava o guardião de um lead novo'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_trava_guardiao_do_lead() from public, anon, authenticated;

drop trigger if exists trg_zz_iavek_trava_guardiao_do_lead on public.crm_leads;
create trigger trg_zz_iavek_trava_guardiao_do_lead
  before insert or update of sdr_user_id, contact_id, owner_user_id on public.crm_leads
  for each row execute function public.fn_iavek_trava_guardiao_do_lead();

-- ---- 5. trava: o responsável da conversa é membro ativo da organização ----
-- Vale para a sessão e para o sistema: atribuir conversa a quem não é membro
-- (ou foi desligado) nunca é certo, e o gatilho da 0579 move os leads junto.
create or replace function public.fn_iavek_responsavel_e_membro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to_user_id is not null
     and new.assigned_to_user_id is distinct from old.assigned_to_user_id
     and not exists (
       select 1 from public.user_organizations uo
        where uo.organization_id = new.organization_id
          and uo.user_id = new.assigned_to_user_id
          and uo.revoked_at is null
          and uo.role in ('agent', 'manager', 'admin'))
  then
    raise exception 'o responsável da conversa precisa ser membro ativo da organização'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_responsavel_e_membro() from public, anon, authenticated;

drop trigger if exists trg_iavek_responsavel_e_membro on public.conversations;
create trigger trg_iavek_responsavel_e_membro
  before update of assigned_to_user_id on public.conversations
  for each row execute function public.fn_iavek_responsavel_e_membro();

-- ---- 6. apagar conversa: só gerente+ ----
drop policy if exists "conversations_agent_delete" on public.conversations;
create policy "conversations_agent_delete" on public.conversations
  for delete using (
    public.fn_is_platform_admin_full()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ---- 7. storage: lgpd-exports só admin lê; ai-policy só gerente+ escreve ----
drop policy if exists "tenant_read_lgpd_exports" on storage.objects;
create policy "tenant_read_lgpd_exports" on storage.objects for select
  using (
    bucket_id = 'lgpd-exports'
    and (split_part(name, '/', 1)) ~* '^[0-9a-f-]{36}$'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
    and public.fn_role_at_least((split_part(name, '/', 1))::uuid, 'admin')
  );

drop policy if exists "tenant_write_ai_policy" on storage.objects;
create policy "tenant_write_ai_policy" on storage.objects for insert
  with check (
    bucket_id = 'ai-policy'
    and (split_part(name, '/', 1)) ~* '^[0-9a-f-]{36}$'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
    and public.fn_role_at_least((split_part(name, '/', 1))::uuid, 'manager')
  );

drop policy if exists "tenant_delete_ai_policy" on storage.objects;
create policy "tenant_delete_ai_policy" on storage.objects for delete
  using (
    bucket_id = 'ai-policy'
    and (split_part(name, '/', 1)) ~* '^[0-9a-f-]{36}$'
    and (split_part(name, '/', 1))::uuid in (select public.fn_user_org_ids())
    and public.fn_role_at_least((split_part(name, '/', 1))::uuid, 'manager')
  );
