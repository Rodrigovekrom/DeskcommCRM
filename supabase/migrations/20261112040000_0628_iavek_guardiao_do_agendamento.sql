-- manifest: ia.vek v1.9.48 (0628) — o lead SEM DONO e SEM GUARDIÃO que alguém de fora do SDR agenda ganha guardião da LISTA do rodízio (a mesma da 0623)
--
-- POR QUÊ: na v1.9.48 todos agendam direto na loja (decisão do Rodrigo, 06/11 e 10/11). A Lupa (113800) mediu que 713
-- dos 934 leads abertos da Fenômenos estão sem dono E sem guardião: o vendedor que agenda um deles fica DONO, mas, sem
-- ser SDR, não vira guardião, e o lead ficava sem guardião (sem o aviso guardiao_tarefa_vencida e sem as 72h do
-- guardião). Decisão do Maestro (113810), o caminho (b): o guardião vem da LISTA do rodízio (Daiane e Paloma, a mesma
-- da v1.9.46), mantendo a regra "todo lead tem um SDR guardião". Lead que JÁ tem guardião fica como está.
--
-- O QUE MUDA (aditiva):
--   1. iavek_rodizio_registros.origem aceita 'guardiao_do_agendamento' (o histórico da vez; nenhuma linha muda);
--   2. fn_iavek_guardiao_do_agendamento(p_org, p_lead, p_ator): escolhe a vez na lista (só os membros ATIVOS dela),
--      pelo último 'guardiao_do_agendamento' de cada um — uma vez PRÓPRIA, que não mexe na vez do aviso do grupo
--      (0623). Com a lista vazia (ou sem ativo), a regra de antes da 0623: as 'sdr' ativas. Grava o guardião SÓ se o
--      lead ainda não tiver (update ... where sdr_user_id is null) e registra a vez. Só o servidor chama (service_role).
-- O dono NÃO é mexido aqui: quem fica dono é quem agendou (a rota já passou o lead a ele).
-- Idempotente. Volta: voltar-0628.sql (tira a função; a regra da origem volta como NOT VALID, sem apagar o histórico).

alter table public.iavek_rodizio_registros drop constraint if exists iavek_rodizio_registros_origem_check;
alter table public.iavek_rodizio_registros add constraint iavek_rodizio_registros_origem_check
  check (origem in ('lead_novo', 'mesmo_dono', 'distribuicao', 'aviso_de_ajuda', 'guardiao_do_agendamento'));

create or replace function public.fn_iavek_guardiao_do_agendamento(p_org uuid, p_lead uuid, p_ator uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_atual uuid;
  v_guardiao uuid;
begin
  -- a mesma trava por organização do rodízio e do aviso do grupo: duas escolhas ao mesmo tempo não pegam a mesma vez
  perform pg_advisory_xact_lock(hashtextextended('iavek_rodizio:' || p_org::text, 0));

  select l.sdr_user_id into v_atual
    from public.crm_leads l
   where l.id = p_lead and l.organization_id = p_org
   for update;
  if not found then
    return null;
  end if;
  if v_atual is not null then
    return v_atual;  -- já tem guardião: fica como está
  end if;

  select p.uid into v_guardiao
    from (select (x.v)::uuid as uid, x.pos
            from jsonb_array_elements_text(coalesce((select o.settings->'iavek'->'rodizio'->'participantes'
                                                       from public.organizations o where o.id = p_org), '[]'::jsonb))
                 with ordinality as x(v, pos)
           where x.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') p
    join public.user_organizations uo on uo.organization_id = p_org and uo.user_id = p.uid and uo.revoked_at is null
   order by (select max(r.created_at) from public.iavek_rodizio_registros r
              where r.organization_id = p_org and r.user_id = p.uid and r.origem = 'guardiao_do_agendamento') asc nulls first,
            p.pos
   limit 1;

  if v_guardiao is null then
    select uo.user_id into v_guardiao
      from public.user_organizations uo
     where uo.organization_id = p_org
       and uo.revoked_at is null
       and uo.role = 'agent'
       and uo.interface_settings->>'funcao' = 'sdr'
     order by (select max(r.created_at) from public.iavek_rodizio_registros r
                where r.organization_id = p_org and r.user_id = uo.user_id and r.origem = 'guardiao_do_agendamento') asc nulls first,
              uo.user_id
     limit 1;
  end if;
  if v_guardiao is null then
    return null;  -- ninguém na lista nem SDR ativa: o lead segue sem guardião, como antes
  end if;

  update public.crm_leads set sdr_user_id = v_guardiao
   where id = p_lead and organization_id = p_org and sdr_user_id is null;
  insert into public.iavek_rodizio_registros (organization_id, lead_id, user_id, origem, decidido_por)
  values (p_org, p_lead, v_guardiao, 'guardiao_do_agendamento', p_ator);
  return v_guardiao;
end;
$$;
revoke execute on function public.fn_iavek_guardiao_do_agendamento(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_guardiao_do_agendamento(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
