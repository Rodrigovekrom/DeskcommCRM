-- manifest: ia.vek v1.7.6 — empresas, pessoas e vínculos B2B (companies, people, company_people): criar, editar e apagar passam a ser só do admin; ler continua de todo membro
--
-- POR QUÊ (decisão do dono do produto, 21/10/2026): "o admin dita a
-- estratégia". O cadastro B2B (empresa, pessoa que decide, vínculo entre as
-- duas) é configuração da loja, não trabalho do atendimento. O vendedor
-- continua corrigindo nome, telefone e e-mail do PRÓPRIO contato no
-- atendimento — isso é a tabela `contacts`, que esta migration não toca.
--
-- O QUE MUDA: as 9 policies de escrita das 3 tabelas. Antes: inserir e apagar
-- = manager+, editar = agent+. Agora: tudo = admin. A leitura (`*_select`) não
-- muda. A API já exige admin nas mesmas rotas (v1.7.6).
--
-- ADITIVA: nenhum dado muda. Idempotente (drop policy if exists + create).

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies
  for insert with check (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update
  using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'))
  with check (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));

drop policy if exists people_insert on public.people;
create policy people_insert on public.people
  for insert with check (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
drop policy if exists people_update on public.people;
create policy people_update on public.people
  for update
  using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'))
  with check (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
drop policy if exists people_delete on public.people;
create policy people_delete on public.people
  for delete using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));

drop policy if exists company_people_insert on public.company_people;
create policy company_people_insert on public.company_people
  for insert with check (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
drop policy if exists company_people_update on public.company_people;
create policy company_people_update on public.company_people
  for update
  using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'))
  with check (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
drop policy if exists company_people_delete on public.company_people;
create policy company_people_delete on public.company_people
  for delete using (organization_id in (select public.fn_user_org_ids())
         and public.fn_role_at_least(organization_id, 'admin'));
