-- manifest: ia.vek v1.9.52 (0634) — a VEZ do SDR de Follow-up: na passagem das 72h, o lead vai para o SDR de Follow-up (rodízio entre os ativos)
--
-- POR QUÊ: CRM-254, decisão do Rodrigo (11/11 02:04Z, "A sim, B sim, C sim, D sim"): na passagem das 72h o lead vai
-- para o SDR de Follow-up como DONO, e as ligações do Follow-up (L3 a L7) passam a ser dele — elas já vão para o dono.
-- Mais de um SDR de Follow-up: rodízio (Maestro 151116, "a esteira entregando ao SDR de Follow-up com o rodízio").
--
-- O QUE MUDA (aditiva):
--   1. iavek_rodizio_registros.origem aceita 'sdr_followup' (o histórico da vez; nenhuma linha muda);
--   2. fn_iavek_sdr_followup_da_vez(p_org, p_lead): escolhe, entre os membros ATIVOS da organização com a função
--      'sdr_followup', o que recebeu há mais tempo (pela vez PRÓPRIA, 'sdr_followup'), registra a vez e devolve o id.
--      Sem nenhum: devolve NULL e não registra nada — a esteira segue a regra de antes (o guardião).
--      NÃO grava o lead: quem grava o dono é a esteira (passarParaFollowup), no mesmo update de sempre.
--      Só o servidor chama (service_role). A trava por organização é a mesma do rodízio (0585/0623/0628).
-- Idempotente. Volta: voltar-0634.sql (tira a função; a regra da origem volta NOT VALID, o histórico fica).

alter table public.iavek_rodizio_registros drop constraint if exists iavek_rodizio_registros_origem_check;
alter table public.iavek_rodizio_registros add constraint iavek_rodizio_registros_origem_check
  check (origem in ('lead_novo', 'mesmo_dono', 'distribuicao', 'aviso_de_ajuda', 'guardiao_do_agendamento', 'sdr_followup'));

create or replace function public.fn_iavek_sdr_followup_da_vez(p_org uuid, p_lead uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_quem uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('iavek_rodizio:' || p_org::text, 0));
  if not exists (select 1 from public.crm_leads l where l.id = p_lead and l.organization_id = p_org) then
    return null;
  end if;

  select uo.user_id into v_quem
    from public.user_organizations uo
   where uo.organization_id = p_org
     and uo.revoked_at is null
     and uo.accepted_at is not null
     and uo.interface_settings->>'funcao' = 'sdr_followup'
   order by (select max(r.created_at) from public.iavek_rodizio_registros r
              where r.organization_id = p_org and r.user_id = uo.user_id and r.origem = 'sdr_followup') asc nulls first,
            uo.created_at, uo.user_id
   limit 1;
  if v_quem is null then
    return null;  -- nenhum SDR de Follow-up ativo: a esteira segue a regra de antes
  end if;

  insert into public.iavek_rodizio_registros (organization_id, lead_id, user_id, origem, decidido_por)
  values (p_org, p_lead, v_quem, 'sdr_followup', null);
  return v_quem;
end;
$$;
revoke execute on function public.fn_iavek_sdr_followup_da_vez(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_sdr_followup_da_vez(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
