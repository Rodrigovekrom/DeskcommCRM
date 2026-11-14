-- manifest: ia.vek v1.9.52.3 (0638) — a passagem ao Follow-up ('moved_to_another_pipeline') não avisa 'guardiao_perda' ao guardião nem 'lead_passado' pelo original fechado
--
-- POR QUÊ (Maestro 002817, Lupa 002312/225428 item 5; regra do Rodrigo do SDR de Follow-up): a passagem das 72h FECHA
-- o original como perdido com o motivo 'moved_to_another_pipeline'. O gatilho fn_iavek_notifica_mudanca_do_lead (0579)
-- avisava o guardião de 'perda' em todo fechamento: MEDIDO 168 'guardiao_perda' em 7 dias na Fenômenos, ~1 por passagem,
-- e nenhum é perda (o Meus números já exclui esse motivo). Com a 52.3, o original fechado passa ao SDR de Follow-up, e
-- a troca de dono do original avisava 'lead_passado' a ele: 2 avisos por passagem (o do clone basta).
-- A MUDANÇA (só esta função; vale para toda org): quando o lead está 'lost' com 'moved_to_another_pipeline', nem o
-- 'guardiao_perda' nem o 'lead_passado'. Todo o resto do gatilho fica IGUAL (os outros motivos de perda, o ganho, a
-- troca de etapa, a troca de dono de lead aberto). Nenhuma tabela, policy ou outra função muda.
-- Volta: voltar-0638.sql (a definição de antes, lida da produção).
CREATE OR REPLACE FUNCTION public.fn_iavek_notifica_mudanca_do_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ator uuid := auth.uid();
  v_etapa_de text;
  v_etapa_para text;
  v_passagem boolean;
begin
  -- Lead passado para alguém (que não foi quem passou para si mesmo).
  -- ia.vek v1.9.52.3 (0638): a PASSAGEM ao Follow-up fecha o original como 'moved_to_another_pipeline'. Isso não é
  -- perda (o Meus números já exclui) nem lead novo para trabalhar: o original fechado que muda de dono não avisa
  -- 'lead_passado' (o aviso vem do CLONE, que é o lead de verdade).
  v_passagem := coalesce(new.status = 'lost' and new.lost_reason = 'moved_to_another_pipeline', false);
  if new.owner_user_id is not null
     and new.owner_user_id is distinct from old.owner_user_id
     and new.owner_user_id is distinct from v_ator
     and not v_passagem
  then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id)
    values (new.organization_id, new.owner_user_id, 'lead_passado', new.id, v_ator);
  end if;

  -- O guardião fica sabendo do que acontece com o lead que ele guarda (menos
  -- do que ele mesmo fez).
  if new.sdr_user_id is not null and new.sdr_user_id is distinct from v_ator then
    -- (0638) e a passagem NÃO avisa 'guardiao_perda' ao guardião (era ~1 aviso falso por passagem: 168 em 7 dias).
    if new.status is distinct from old.status and new.status in ('won', 'lost') and not v_passagem then
      insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id, dados)
      values (
        new.organization_id, new.sdr_user_id,
        case when new.status = 'won' then 'guardiao_ganho' else 'guardiao_perda' end,
        new.id, v_ator,
        case when new.status = 'lost' and new.lost_reason is not null
             then jsonb_build_object('motivo', new.lost_reason)
             else '{}'::jsonb end
      );
    elsif new.stage_id is distinct from old.stage_id and new.status = 'open' then
      select name into v_etapa_de from public.crm_stages where id = old.stage_id;
      select name into v_etapa_para from public.crm_stages where id = new.stage_id;
      insert into public.notificacoes (organization_id, user_id, tipo, lead_id, ator_user_id, dados)
      values (
        new.organization_id, new.sdr_user_id, 'guardiao_etapa', new.id, v_ator,
        jsonb_build_object('de', v_etapa_de, 'para', v_etapa_para)
      );
    end if;
  end if;
  return null;
end;
$function$;
