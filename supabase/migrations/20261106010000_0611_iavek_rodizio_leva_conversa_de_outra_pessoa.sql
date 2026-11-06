-- manifest: ia.vek 0611 — a entrega do rodízio (lead novo, distribuição/CRM-228 e aviso do grupo) também leva a conversa quando ela está com OUTRA pessoa; a conversa da IA ou sem ninguém fica como hoje (decisão do Maestro, 06/11)
--
-- POR QUÊ: o dono do lead não é o dono da conversa. A RLS da conversa (0580) só deixa o vendedor
-- ver a conversa atribuída a ele ou sem ninguém. `fn_iavek_rodizio_entregar` só levava a conversa
-- SEM NINGUÉM; se outra pessoa já a tinha pego, o novo dono recebia o lead e não enxergava a
-- conversa (GET = 404). A mesma guarda do cartão e do lote (CRM-244 Fase 2):
--   · conversa mais recente com OUTRA pessoa  -> transferência (motivo 'transfer') + linha
--     "Transferiu a conversa" no histórico do lead;
--   · sem ninguém                              -> como hoje ('routing', não silencia a IA);
--   · já com o novo dono                       -> nada.
-- ADITIVA: só troca o corpo da função (mesma assinatura, mesmos grants). Volta: voltar.sql do ensaio.

create or replace function public.fn_iavek_rodizio_entregar(
  p_org uuid, p_lead uuid, p_user uuid, p_origem text, p_por uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contato uuid;
  v_conversa uuid;
  v_recente uuid;
  v_com uuid;
begin
  update public.crm_leads
     set owner_user_id = p_user,
         owner_agent_id = null,
         owner_kind = 'user',
         assigned_at = now()
   where organization_id = p_org
     and id = p_lead
     and owner_user_id is null
     and owner_agent_id is null
  returning contact_id into v_contato;
  if not found then
    return false;
  end if;

  if v_contato is not null then
    -- 0611: a conversa mais recente do contato está com OUTRA pessoa? Vai para o novo dono.
    select c.id, c.assigned_to_user_id into v_recente, v_com
      from public.conversations c
     where c.organization_id = p_org
       and c.contact_id = v_contato
       and coalesce(c.is_group, false) = false
       and c.status <> 'archived'
     order by c.last_message_at desc nulls last
     limit 1;
    if v_recente is not null and v_com is not null and v_com <> p_user then
      perform public.fn_conversation_assign(p_org, v_recente, p_user, 'transfer', null, false);
      insert into public.crm_lead_activities
        (organization_id, lead_id, contact_id, source_module, source_id, type,
         actor_kind, reason, payload, metadata, performed_at, performed_by_user_id)
      values
        (p_org, p_lead, v_contato, 'inbox.comando', v_recente, 'conversation_transferred',
         case when p_por is null then 'rule' else 'user' end,
         'Transferiu a conversa junto com o responsável do negócio',
         jsonb_build_object('conversation_id', v_recente, 'to_user_id', p_user, 'origem', p_origem),
         '{}'::jsonb, now(), p_por);
    else
      -- Como antes da 0611: a conversa SEM NINGUÉM vai pelo roteamento (a IA segue).
      select c.id into v_conversa
        from public.conversations c
       where c.organization_id = p_org
         and c.contact_id = v_contato
         and coalesce(c.is_group, false) = false
         and c.status <> 'archived'
         and c.assigned_to_user_id is null
       order by c.last_message_at desc nulls last
       limit 1;
      if v_conversa is not null then
        perform public.fn_conversation_assign(p_org, v_conversa, p_user, 'routing', null, true);
      end if;
    end if;
  end if;

  insert into public.iavek_rodizio_registros (organization_id, lead_id, user_id, origem, decidido_por)
  values (p_org, p_lead, p_user, p_origem, p_por);
  return true;
end;
$$;
revoke execute on function public.fn_iavek_rodizio_entregar(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_rodizio_entregar(uuid, uuid, uuid, text, uuid) to service_role;
