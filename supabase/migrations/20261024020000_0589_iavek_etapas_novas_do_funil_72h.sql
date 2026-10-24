-- manifest: ia.vek v1.8.2 — etapas novas do funil "fenomenos-72h" (IA responsável → Lead novo → Em atendimento → Não responde → Agendamento → Ligação de vídeo feita → Lead qualificado → Troca → Muito longe → Vendido → Perdido); renomeia SEM trocar id, arquiva CTA e Passado ao SDR depois de mover os leads delas para Em atendimento; nenhum lead nem etapa é apagado
--
-- POR QUÊ (pedido do Rodrigo, 24/10/2026; decisões do Maestro): o funil passa a
-- seguir a operação real — a IA atende, o vendedor atende, agenda, faz a
-- ligação de vídeo, qualifica, troca, vende ou perde.
--
-- COMO, E POR QUE ASSIM:
--   * RENOMEAR no lugar (mesmo id): webhooks (`default_stage_id`), a esteira
--     (`settings.esteira.entrada.etapas_de_compromisso`), o histórico
--     (`lost_from_stage_id`, atividades) e as preferências de tela apontam para
--     o ID. Trocar id quebraria tudo isso; trocar o nome não quebra nada.
--   * Os SLUGS antigos ficam (o slug não aparece na tela; nenhum código os lê).
--   * Mapa das etapas antigas: Novo → Lead novo; Em atendimento IA → IA
--     responsável; Carro apresentado → Em atendimento; CTA → Em atendimento;
--     Agendado/Vídeo → Agendamento; Qualificado → Lead qualificado; Passado ao
--     SDR → Em atendimento; Vendido e Perdido ficam.
--   * CTA e Passado ao SDR: os leads delas vão para Em atendimento, e só DEPOIS
--     elas são ARQUIVADAS (nunca apagadas — o histórico continua apontando).
--   * "Muito longe" é etapa PRÓPRIA (aberta): o banco só aceita UMA etapa de
--     perda por funil (`uniq_crm_stages_pipeline_lost`).
--   * Lead novo nasce na PRIMEIRA etapa aberta pela posição
--     (`lib/leads/nascimento-do-lead.ts`) — com esta ordem, "IA responsável".
--
-- IDEMPOTENTE: rodar de novo não muda nada (insere só o que falta, renomeia
-- para o mesmo nome, move zero leads). Só alcança funil com slug
-- `fenomenos-72h`; em qualquer outro banco não faz nada.

do $$
declare
  f record;
  v_em_atendimento uuid;
begin
  for f in select id, organization_id from public.crm_pipelines where slug = 'fenomenos-72h' loop
    -- 1. as etapas novas (só se faltarem)
    insert into public.crm_stages (organization_id, pipeline_id, name, slug, position)
    select f.organization_id, f.id, n.nome, n.slug, n.pos
      from (values ('Não responde', 'nao-responde', 4000),
                   ('Ligação de vídeo feita', 'ligacao-de-video', 6000),
                   ('Troca', 'troca', 8000),
                   ('Muito longe', 'muito-longe', 9000)) n(nome, slug, pos)
     where not exists (select 1 from public.crm_stages s where s.pipeline_id = f.id and s.slug = n.slug);

    -- 2. os leads de CTA e Passado ao SDR vão para Em atendimento (ex-Carro apresentado)
    select id into v_em_atendimento from public.crm_stages where pipeline_id = f.id and slug = 'carro-apresentado';
    if v_em_atendimento is not null then
      update public.crm_leads l
         set stage_id = v_em_atendimento
       where l.pipeline_id = f.id
         and l.stage_id in (select id from public.crm_stages where pipeline_id = f.id and slug in ('cta', 'passado-ao-sdr'));
    end if;

    -- 3. nomes e ordem novos (mesmo id)
    update public.crm_stages s
       set name = m.nome, position = m.pos, is_archived = false
      from (values ('em-atendimento-ia', 'IA responsável', 1000),
                   ('novo', 'Lead novo', 2000),
                   ('carro-apresentado', 'Em atendimento', 3000),
                   ('nao-responde', 'Não responde', 4000),
                   ('agendado-video', 'Agendamento', 5000),
                   ('ligacao-de-video', 'Ligação de vídeo feita', 6000),
                   ('qualificado', 'Lead qualificado', 7000),
                   ('troca', 'Troca', 8000),
                   ('muito-longe', 'Muito longe', 9000),
                   ('vendido', 'Vendido', 10000),
                   ('perdido', 'Perdido', 11000)) m(slug, nome, pos)
     where s.pipeline_id = f.id and s.slug = m.slug
       and (s.name, s.position, s.is_archived) is distinct from (m.nome, m.pos::numeric, false);

    -- 4. CTA e Passado ao SDR saem do quadro — só se ficaram vazias
    update public.crm_stages s
       set is_archived = true
     where s.pipeline_id = f.id and s.slug in ('cta', 'passado-ao-sdr') and not s.is_archived
       and not exists (select 1 from public.crm_leads l where l.stage_id = s.id);
  end loop;
end $$;
