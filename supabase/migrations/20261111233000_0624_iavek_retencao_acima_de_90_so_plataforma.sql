-- manifest: ia.vek v1.9.46 (0624) — guardar a mídia por MAIS de 90 dias é um opcional (pago): só o admin da PLATAFORMA (a ia.vek) sobe organizations.media_retention_days acima de 90; o admin da empresa escolhe até 90
--
-- POR QUÊ: decisão do Rodrigo (11/11, via Maestro 223044 e 223213): a mídia fica 3 meses (0622), e mais tempo é um
-- opcional por organização, pago. Hoje o admin da própria empresa podia subir até 3.650 dias na tela, sozinho e de
-- graça. ⚠️ A TRAVA DE VERDADE é a do servidor (updateTenant + podeGuardarMidiaPor): a organização é gravada com
-- service_role (a RLS de organizations só deixa a plataforma escrever), e por esse caminho o gatilho NÃO vê o usuário
-- (auth.uid() nulo = o sistema). Este gatilho é a 2ª camada: barra qualquer escrita feita com o login do usuário.
--
-- A REGRA (gatilho BEFORE UPDATE em organizations):
--   · subir media_retention_days para MAIS de 90 → só o admin da plataforma com scope 'full' (fn_is_platform_admin_full,
--     a mesma regra da policy de escrita; a sessão de SUPORTE não passa — Lupa, v1.9.46) ou o próprio
--     sistema (sem usuário: service_role, crons, scripts da troca);
--   · baixar, ou deixar igual, sempre pode (inclusive regravar o formulário com os 180 que a plataforma ligou).
-- Idempotente. Volta: voltar-0624.sql (tira o gatilho).

create or replace function public.fn_iavek_trava_retencao_paga()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.media_retention_days is distinct from old.media_retention_days
     and new.media_retention_days > 90
     and new.media_retention_days > coalesce(old.media_retention_days, 0)
     and auth.uid() is not null
     and not public.fn_is_platform_admin_full()
  then
    raise exception 'retencao_acima_de_90_so_plataforma'
      using errcode = '42501',
            hint = 'Guardar por mais de 90 dias é um opcional; fale com a ia.vek.';
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_iavek_trava_retencao_paga() from public, anon, authenticated;

drop trigger if exists trg_iavek_trava_retencao_paga on public.organizations;
create trigger trg_iavek_trava_retencao_paga
  before update of media_retention_days on public.organizations
  for each row execute function public.fn_iavek_trava_retencao_paga();

notify pgrst, 'reload schema';
