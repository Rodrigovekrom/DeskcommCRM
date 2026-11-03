-- manifest: ia.vek v1.9.15 (0603) — desempenho sem mudar quem vê o quê: auditoria, tokens e convites deixam de chamar função por linha, na mesma forma da 0602
--
-- MEDIDO na produção (03/11): a auditoria custava 6 ms por linha a quem não é admin
-- (25 mil linhas para devolver 0 a um gerente, cortado pelo tempo limite do papel), e as
-- regras de escrita "para tudo" de tokens e convites também rodavam na leitura.
--
-- NADA MUDA em quem vê ou escreve o quê. Comparação por papel, antes e depois, fora deste
-- repositório. Depende de fn_iavek_orgs_com_papel (0602).

drop policy if exists "audit_log_select" on public.api_audit_log;
create policy "audit_log_select" on public.api_audit_log
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
  );

drop policy if exists "api_tokens_tenant_read" on public.api_tokens;
create policy "api_tokens_tenant_read" on public.api_tokens
  for select using (
    organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
    or (select public.fn_is_platform_admin())
  );
drop policy if exists "api_tokens_admin_write" on public.api_tokens;
drop policy if exists "api_tokens_insert" on public.api_tokens;
create policy "api_tokens_insert" on public.api_tokens
  for insert with check (
    organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
    or (select public.fn_is_platform_admin_full())
  );
drop policy if exists "api_tokens_update" on public.api_tokens;
create policy "api_tokens_update" on public.api_tokens
  for update using (
    organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
    or (select public.fn_is_platform_admin_full())
  ) with check (
    organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
    or (select public.fn_is_platform_admin_full())
  );
drop policy if exists "api_tokens_delete" on public.api_tokens;
create policy "api_tokens_delete" on public.api_tokens
  for delete using (
    organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
    or (select public.fn_is_platform_admin_full())
  );

drop policy if exists team_invites_select on public.team_invites;
create policy team_invites_select on public.team_invites
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_iavek_orgs_com_papel('manager'))
  );
drop policy if exists team_invites_write on public.team_invites;
drop policy if exists team_invites_insert on public.team_invites;
create policy team_invites_insert on public.team_invites
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
  );
drop policy if exists team_invites_update on public.team_invites;
create policy team_invites_update on public.team_invites
  for update using (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
  ) with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
  );
drop policy if exists team_invites_delete on public.team_invites;
create policy team_invites_delete on public.team_invites
  for delete using (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_iavek_orgs_com_papel('admin'))
  );
