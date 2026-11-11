-- manifest: ia.vek v1.9.45 (0619, CRM-280) — `calendar_appointments` ganha o CEP, o número e o km de carro da loja até o cliente (agendamento "Ir até o cliente"); o endereço por extenso continua em `location_details`
--
-- POR QUÊ: o Rodrigo (10/11, CRM-255) pediu o endereço e o km no "Ir até o cliente"; em 11/11 aprovou a
-- opção 1, grátis (ViaCEP + OpenRouteService). O endereço por extenso já tem lugar (`location_details`,
-- texto de até 300). Faltavam o CEP e o número (para recalcular e conferir) e o km calculado.
--
-- ADITIVA E ANULÁVEL: nenhuma linha muda; os compromissos de antes ficam com as 3 colunas nulas. O km é
-- calculado pelo SERVIDOR (lib/iavek/km/calcular-km.ts), nunca pela tela. Sem a chave do OpenRouteService
-- o km fica nulo e o resto do agendamento segue igual.
-- Idempotente (add column if not exists; as constraints só entram se ainda não existirem).
-- Volta: voltar-0619.sql (devolve o gatilho da LGPD da 0184 e faz drop column, que leva as constraints junto).

alter table public.calendar_appointments add column if not exists iavek_cep text;
alter table public.calendar_appointments add column if not exists iavek_numero text;
alter table public.calendar_appointments add column if not exists iavek_km numeric(7,1);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'calendar_appointments_iavek_cep_formato'
                   and conrelid = 'public.calendar_appointments'::regclass) then
    alter table public.calendar_appointments
      add constraint calendar_appointments_iavek_cep_formato check (iavek_cep is null or iavek_cep ~ '^[0-9]{8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'calendar_appointments_iavek_numero_tamanho'
                   and conrelid = 'public.calendar_appointments'::regclass) then
    alter table public.calendar_appointments
      add constraint calendar_appointments_iavek_numero_tamanho check (iavek_numero is null or length(iavek_numero) between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'calendar_appointments_iavek_km_faixa'
                   and conrelid = 'public.calendar_appointments'::regclass) then
    alter table public.calendar_appointments
      add constraint calendar_appointments_iavek_km_faixa check (iavek_km is null or (iavek_km >= 0 and iavek_km <= 5000));
  end if;
end
$$;

comment on column public.calendar_appointments.iavek_cep is
  'ia.vek v1.9.45 (CRM-280): CEP do cliente (8 dígitos) no "Ir até o cliente". O endereço por extenso fica em location_details.';
comment on column public.calendar_appointments.iavek_numero is
  'ia.vek v1.9.45 (CRM-280): número do endereço do cliente.';
comment on column public.calendar_appointments.iavek_km is
  'ia.vek v1.9.45 (CRM-280): km de carro da loja até o cliente, calculado pelo servidor (OpenRouteService). Nulo = indisponível.';

-- LGPD: CEP, número e km são dado pessoal (o endereço do cliente; o km da loja também aponta o lugar). O
-- gatilho que já apaga location_details quando o contato é anonimizado (migration 0184) passa a apagar
-- os 3 também. Mesmo corpo da 0184, com as 3 colunas a mais.
create or replace function public.fn_redigir_agenda_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.calendar_appointments
     set title               = 'Compromisso anonimizado',
         description         = null,
         notes               = null,
         location_details    = null,
         meeting_url         = null,
         cancellation_reason = null,
         iavek_cep           = null,
         iavek_numero        = null,
         iavek_km            = null
   where organization_id = new.organization_id
     and contact_id = new.id;
  return new;
end;
$$;
revoke execute on function public.fn_redigir_agenda_do_contato_anonimizado() from public, anon, authenticated;
grant  execute on function public.fn_redigir_agenda_do_contato_anonimizado() to service_role;

notify pgrst, 'reload schema';
