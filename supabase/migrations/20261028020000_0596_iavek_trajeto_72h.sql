-- manifest: ia.vek v1.9.4 — trajeto do lead em 72h (CRM-209): o sino ganha os avisos de lead devolvido ao guardião, lead retirado do vendedor e lead reativado do follow-up; a trava de campos ao mover passa a valer nas etapas do funil novo da loja (Negociando, Fez ligação de vídeo, Ficha feita, Ficha aprovada, Venda 100% web, Agendado, Vendido). Aditiva; nenhum dado muda.
--
-- POR QUÊ (decisões do Rodrigo, 27/10/2026)
--   · Cada troca de mão do lead deixa aviso para quem recebe e para quem perde:
--     o vendedor que DESISTE devolve ao guardião (lead_devolvido); o guardião
--     pode TIRAR o lead do vendedor dentro das 72h (lead_retirado, para o
--     vendedor); o lead do follow-up que REATIVA volta ao SDR (lead_reativado).
--   · A trava de campos ao mover (0590) olhava as etapas do funil antigo
--     (inclusive "Troca", arquivada na v1.9.3). Agora olha as de compromisso do
--     funil novo. Ela continua valendo só com a chave da empresa ligada.
alter table public.notificacoes drop constraint if exists notificacoes_tipo_check;
alter table public.notificacoes add constraint notificacoes_tipo_check check (tipo in (
  'lead_passado',
  'guardiao_etapa',
  'guardiao_ganho',
  'guardiao_perda',
  'guardiao_tarefa_vencida',
  'tarefa_vencida',
  'proposta_aguardando_aprovacao',
  'proposta_aprovada',
  'proposta_devolvida',
  'pedido_de_agendamento',
  'pedido_de_agendamento_confirmado',
  'pedido_de_agendamento_recusado',
  'ficha_enviada',
  'ficha_decidida',
  'agendamento_para_voce',
  'lead_devolvido',
  'lead_retirado',
  'lead_reativado'
));

create or replace function public.fn_iavek_campos_obrigatorios_ao_mover()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_faltam text[];
begin
  if auth.uid() is null or new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = new.organization_id
                    and coalesce((o.settings->'iavek'->'campos_obrigatorios'->>'ativo')::boolean, false)) then
    return new;
  end if;
  if not exists (select 1 from public.crm_stages s
                  where s.id = new.stage_id
                    and s.slug in ('agendado-video', 'qualificado', 'ligacao-de-video', 'ficha-feita',
                                   'ficha-aprovada', 'venda-100-web', 'vendido')) then
    return new;
  end if;
  v_faltam := public.fn_iavek_campos_que_faltam_do_lead(new);
  if coalesce(array_length(v_faltam, 1), 0) > 0 then
    raise exception 'Faltam campos obrigatórios: %', array_to_string(v_faltam, ', ')
      using errcode = 'PT422';
  end if;
  return new;
end;
$$;
