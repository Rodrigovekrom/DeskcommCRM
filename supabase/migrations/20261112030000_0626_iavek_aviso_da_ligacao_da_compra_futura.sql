-- manifest: ia.vek v1.9.47 (0626) — a ligação dos 7 dias antes da Compra futura AVISA quando vence (nota 2 da Lupa
-- na v1.9.45), e a correção do cabeçalho da 0619 (Maestro 030158).
--
-- 1. O AVISO DA LIGAÇÃO DA COMPRA FUTURA
--    A 0621 fez fn_iavek_notifica_tarefa_vencida calar toda tarefa de lead que não está 'open' (perdido, ganho e
--    Compra futura). Mas a ligação dos 7 dias antes (lib/iavek/compra-futura/rodada.ts, interruptor
--    ligacao_7_dias, hoje DESLIGADO) nasce de propósito num lead que SEGUE em 'future' (até o vendedor o trazer de
--    volta). Com a 0621, ela vencia calada: o vendedor nunca era avisado. Agora a exceção é ESTREITA:
--      lead 'future' E a tarefa com source_kind 'ligacao:compra_futura' (só a rodada da Compra futura grava esse
--      valor, a partir desta versão) => avisa, como uma tarefa de lead aberto.
--    Todo o resto fica como na 0621: perdido e ganho não avisam; outra tarefa num lead 'future' não avisa.
--    O 'ligacao:compra_futura' começa com 'ligacao': para a 0625 (o ganho cancela a pré-venda) ela continua
--    pré-venda, como antes.
--    MEDIDO na produção (11/11): 0 leads 'future' (a 0620 ainda não está lá) e o interruptor desligado: nenhuma
--    linha muda; a função só passa a valer quando o Rodrigo ligar o ligacao_7_dias.
--
-- 2. A CORREÇÃO DO CABEÇALHO DA 0619 (só registro; a 0619 aprovada tem o sha travado e não é editada)
--    O cabeçalho da 20261111190000_0619_iavek_cep_e_km_do_agendamento.sql diz que a volta "devolve o gatilho da
--    LGPD da 0184 e faz drop column". NÃO é assim: a voltar-0619.sql aprovada é uma NO-OP de propósito. As 3
--    colunas (iavek_cep, iavek_numero, iavek_km) ficam, e fn_redigir_agenda_do_contato_anonimizado fica no corpo da
--    0619 (que também apaga CEP, número e km na anonimização: voltar o da 0184 seria retrocesso de LGPD). A prova
--    das voltas a trata como exceção DECLARADA (MANTEM_DE_PROPOSITO na migrations-v145.lista, com o md5 inteiro).
--
-- Volta: voltar-0626.sql (ops) devolve o corpo da 0621.
-- Idempotente (create or replace). Sem tabela, coluna nem gatilho novo.

create or replace function public.fn_iavek_notifica_tarefa_vencida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
  v_sdr uuid;
  v_status_do_lead text;
begin
  select t.id, t.organization_id, t.assigned_to, t.lead_id, t.status, t.source_kind
    into v_task
    from public.crm_tasks t
   where t.id = new.entity_id
     and t.organization_id = new.organization_id;
  if not found then
    return null;
  end if;

  -- ia.vek 0621: tarefa que não está mais pendente não vence (cancelada ou feita)
  if v_task.status not in ('pending', 'in_progress') then
    return null;
  end if;

  if v_task.lead_id is not null then
    select l.status, l.sdr_user_id into v_status_do_lead, v_sdr
      from public.crm_leads l
     where l.id = v_task.lead_id and l.organization_id = v_task.organization_id;
    -- ia.vek 0621: tarefa de lead que não está 'open' (perdido, ganho ou em Compra futura) não avisa.
    -- ia.vek 0626: menos a ligação dos 7 dias antes da Compra futura, que nasce de propósito no lead 'future'.
    if v_status_do_lead is distinct from 'open'
       and not (v_status_do_lead = 'future' and v_task.source_kind = 'ligacao:compra_futura') then
      return null;
    end if;
  end if;

  if v_task.assigned_to is not null then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, task_id)
    values (v_task.organization_id, v_task.assigned_to, 'tarefa_vencida', v_task.lead_id, v_task.id);
  end if;

  if v_sdr is not null and v_sdr is distinct from v_task.assigned_to then
    insert into public.notificacoes (organization_id, user_id, tipo, lead_id, task_id)
    values (v_task.organization_id, v_sdr, 'guardiao_tarefa_vencida', v_task.lead_id, v_task.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_iavek_notifica_tarefa_vencida() from public, anon, authenticated;

notify pgrst, 'reload schema';
