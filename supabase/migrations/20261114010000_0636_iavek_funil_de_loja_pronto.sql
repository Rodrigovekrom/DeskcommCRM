-- manifest: ia.vek v1.9.54 (0636, CRM-357) — o funil de LOJA DE CARROS pronto ao criar a empresa: fn_iavek_semear_funil_loja cria o funil de 72h (padrão) e o de Follow-up a partir do RETRATO da Fenômenos de 13/11 (sem ids; os slugs que as regras usam), e o settings.esteira DESLIGADO; idempotente, trava por org, só o service_role.
-- ia.vek v1.9.54 (CRM-357; Lupa 193007/213948, Maestro 214139): o funil de LOJA DE CARROS pronto ao criar a empresa.
--
-- fn_iavek_semear_funil_loja(p_org) cria, numa org de loja de carros, os 2 funis do modelo (o de 72h, que vira o padrão,
-- e o de Follow-up), com as etapas, os campos e os "lados do funil", e o settings.esteira (DESLIGADO: ativa = false).
--
-- O MODELO é o RETRATO da Fenômenos de 13/11/2026 (crm357/modelo-loja-20261113.json, sha256 e9f9a35e…), SEM nenhum id:
-- as referências a funil/etapa são '@funil:<slug>' e '@etapa:<funil>:<slug>', remapeadas aqui para os ids novos.
-- (Rodrigo CRM-172, 13/11) SEM as 4 etapas vazias que na Fenômenos estão arquivadas: CTA, Passado ao SDR, Troca e Muito
-- longe (o funil de 72h tem 17 etapas). Os SLUGS das etapas são os da Fenômenos DE PROPÓSITO: as regras dependem deles (0589/0590/0596/0608). O modelo NÃO
-- acompanha mudanças futuras da Fenômenos: atualizar = migration nova. Nenhum dado da loja (nomes, telefones) entra.
--
-- Resultados: 'criado' | 'ja_tinha' (a org já tem settings.esteira: NADA é escrito) | 'tem_funil_sem_esteira' (o funil
-- 'loja-72h' existe mas a esteira não: NADA é escrito; quem decide é uma pessoa). Idempotente e à prova de corrida
-- (advisory lock por org). Uma referência do modelo sem destino = EXCEPTION (nunca um id nulo calado).
-- Só o service_role executa. Volta: voltar-0636.sql (drop das funções; os funis já criados ficam).

-- Os nomes dos 2 funis, num lugar só (as perguntas ao Rodrigo seguem abertas; trocar aqui = trocar o nome).
create or replace function public.fn_iavek_nomes_do_funil_de_loja()
returns jsonb language sql immutable as $n$
  select '{"loja-72h": "Atendimento 72h", "loja-follow-up": "Follow-up"}'::jsonb
$n$;

-- Troca toda string '@...' (em valor OU em chave) pelo id do mapa; sem destino = exception.
create or replace function public.fn_iavek_resolver_modelo(p_j jsonb, p_mapa jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $r$
declare
  v_out jsonb;
  v_k text;
  v_v jsonb;
  v_s text;
begin
  case jsonb_typeof(p_j)
    when 'object' then
      v_out := '{}'::jsonb;
      for v_k, v_v in select key, value from jsonb_each(p_j) loop
        if left(v_k, 1) = '@' then
          if not (p_mapa ? v_k) then raise exception 'modelo do funil de loja: referência sem destino: %', v_k; end if;
          v_k := p_mapa->>v_k;
        end if;
        v_out := v_out || jsonb_build_object(v_k, public.fn_iavek_resolver_modelo(v_v, p_mapa));
      end loop;
      return v_out;
    when 'array' then
      select coalesce(jsonb_agg(public.fn_iavek_resolver_modelo(e, p_mapa) order by o), '[]'::jsonb) into v_out
        from jsonb_array_elements(p_j) with ordinality as t(e, o);
      return v_out;
    when 'string' then
      v_s := p_j #>> '{}';
      if left(v_s, 1) = '@' then
        if not (p_mapa ? v_s) then raise exception 'modelo do funil de loja: referência sem destino: %', v_s; end if;
        return to_jsonb(p_mapa->>v_s);
      end if;
      return p_j;
    else
      return p_j;
  end case;
end
$r$;

create or replace function public.fn_iavek_semear_funil_loja(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modelo constant jsonb := $modelo${"esteira": {"ativa": false, "entrada": {"etapas_de_compromisso": ["@etapa:loja-72h:agendado-video", "@etapa:loja-72h:qualificado", "@etapa:loja-72h:ligacao-de-video", "@etapa:loja-72h:ficha-feita", "@etapa:loja-72h:ficha-aprovada", "@etapa:loja-72h:venda-100-web"], "horas": 72, "pipeline_id": "@funil:loja-72h"}, "followup": {"etapa_reengajou": "@etapa:loja-follow-up:reengajou", "fases": [{"ate_dia": 10, "etapa_id": "@etapa:loja-follow-up:d03-10"}, {"ate_dia": 30, "etapa_id": "@etapa:loja-follow-up:d11-30"}, {"ate_dia": 60, "etapa_id": "@etapa:loja-follow-up:d31-60"}, {"ate_dia": 90, "etapa_id": "@etapa:loja-follow-up:d61-90"}], "pipeline_id": "@funil:loja-follow-up"}}, "funis": [{"etapas": [{"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "3–10 dias", "position": 1000, "requires_human": false, "slug": "d03-10", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "11–30 dias", "position": 2000, "requires_human": false, "slug": "d11-30", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "31–60 dias", "position": 3000, "requires_human": false, "slug": "d31-60", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "61–90 dias", "position": 4000, "requires_human": false, "slug": "d61-90", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Reengajou", "position": 5000, "requires_human": false, "slug": "reengajou", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": true, "is_lost": false, "is_won": false, "name": "Compra futura", "position": 5500.0, "requires_human": false, "slug": "compra-futura", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": true, "name": "Vendido", "position": 6000, "requires_human": false, "slug": "vendido", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": true, "is_won": false, "name": "Perdido", "position": 7000, "requires_human": false, "slug": "perdido", "win_probability": null}], "is_default": false, "position": 8000, "settings": {"canonical_tags": [], "fields": [{"key": "carro_interesse", "label": "Carro de interesse", "type": "catalog_product"}, {"key": "forma_pagamento", "label": "Forma de pagamento", "options": [{"label": "À vista", "value": "a_vista"}, {"label": "Financiamento", "value": "financiamento"}, {"label": "Consórcio", "value": "consorcio"}], "type": "select"}, {"key": "entrada_reais", "label": "Entrada (R$)", "type": "number"}, {"key": "prazo_compra", "label": "Prazo para comprar", "options": [{"label": "0 a 7 dias", "value": "0_7"}, {"label": "7 a 15 dias", "value": "7_15"}, {"label": "15 a 30 dias", "value": "15_30"}, {"label": "Mais de 30 dias", "value": "30_mais"}], "type": "select"}, {"key": "cidade", "label": "Cidade / região", "type": "text"}, {"key": "tem_troca", "label": "Tem carro na troca?", "type": "boolean"}, {"key": "troca_modelo", "label": "Troca: modelo", "type": "text"}, {"key": "troca_ano", "label": "Troca: ano", "type": "number"}, {"key": "troca_km", "label": "Troca: km", "type": "number"}, {"key": "parcela_desejavel", "label": "Parcela desejável (R$)", "type": "number"}], "identity_resolution": {"fields_in_priority_order": ["cpf", "phone_e164", "email"]}, "lost_reasons": [], "reabertura": "mesmo_registro", "won_reason_required": false, "won_reasons": []}, "slug": "loja-follow-up"}, {"etapas": [{"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "IA Atendendo", "position": 1000, "requires_human": false, "slug": "novo", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Suporte IA", "position": 2000, "requires_human": false, "slug": "em-atendimento-ia", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Em atendimento", "position": 3000, "requires_human": false, "slug": "carro-apresentado", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Não responde", "position": 4000, "requires_human": false, "slug": "nao-responde", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Com entrada", "position": 5000, "requires_human": false, "slug": "com-entrada", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Sem entrada", "position": 6000, "requires_human": false, "slug": "sem-entrada", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "À vista", "position": 7000, "requires_human": false, "slug": "a-vista", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Agendado", "position": 8000, "requires_human": false, "slug": "agendado-video", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Negociando", "position": 9000, "requires_human": false, "slug": "qualificado", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Não responde (vendedor)", "position": 10000, "requires_human": false, "slug": "nao-responde-vendedor", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Fez ligação de vídeo", "position": 11000, "requires_human": false, "slug": "ligacao-de-video", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Ficha feita", "position": 12000, "requires_human": false, "slug": "ficha-feita", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Ficha aprovada", "position": 13000, "requires_human": false, "slug": "ficha-aprovada", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": false, "name": "Venda 100% web", "position": 14000, "requires_human": false, "slug": "venda-100-web", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": true, "is_lost": false, "is_won": false, "name": "Compra futura", "position": 14500.0, "requires_human": false, "slug": "compra-futura", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": false, "is_won": true, "name": "Vendido", "position": 15000, "requires_human": false, "slug": "vendido", "win_probability": null}, {"agent_stage_hint": null, "avisar_na_central": false, "color": null, "description": null, "expected_duration_hours": null, "is_archived": false, "is_compra_futura": false, "is_lost": true, "is_won": false, "name": "Perdido", "position": 16000, "requires_human": false, "slug": "perdido", "win_probability": null}], "is_default": true, "position": 9000, "settings": {"canonical_tags": [], "etapa_de_entrada": "novo", "fields": [{"key": "carro_interesse", "label": "Carro de interesse", "type": "catalog_product"}, {"key": "forma_pagamento", "label": "Forma de pagamento", "options": [{"label": "À vista", "value": "a_vista"}, {"label": "Financiamento", "value": "financiamento"}, {"label": "Consórcio", "value": "consorcio"}], "type": "select"}, {"key": "entrada_reais", "label": "Entrada (R$)", "type": "number"}, {"key": "prazo_compra", "label": "Prazo para comprar", "options": [{"label": "0 a 7 dias", "value": "0_7"}, {"label": "7 a 15 dias", "value": "7_15"}, {"label": "15 a 30 dias", "value": "15_30"}, {"label": "Mais de 30 dias", "value": "30_mais"}], "type": "select"}, {"key": "cidade", "label": "Cidade / região", "type": "text"}, {"key": "tem_troca", "label": "Tem carro na troca?", "type": "boolean"}, {"key": "troca_modelo", "label": "Troca: modelo", "type": "text"}, {"key": "troca_ano", "label": "Troca: ano", "type": "number"}, {"key": "troca_km", "label": "Troca: km", "type": "number"}, {"key": "parcela_desejavel", "label": "Parcela desejável (R$)", "type": "number"}], "iavek_lados": {"@etapa:loja-72h:a-vista": "sdr", "@etapa:loja-72h:agendado-video": "ambos", "@etapa:loja-72h:carro-apresentado": "sdr", "@etapa:loja-72h:com-entrada": "sdr", "@etapa:loja-72h:em-atendimento-ia": "sdr", "@etapa:loja-72h:ficha-aprovada": "vendedor", "@etapa:loja-72h:ficha-feita": "vendedor", "@etapa:loja-72h:ligacao-de-video": "vendedor", "@etapa:loja-72h:nao-responde": "sdr", "@etapa:loja-72h:nao-responde-vendedor": "vendedor", "@etapa:loja-72h:novo": "sdr", "@etapa:loja-72h:perdido": "ambos", "@etapa:loja-72h:qualificado": "vendedor", "@etapa:loja-72h:sem-entrada": "sdr", "@etapa:loja-72h:venda-100-web": "vendedor", "@etapa:loja-72h:vendido": "ambos"}, "identity_resolution": {"fields_in_priority_order": ["cpf", "phone_e164", "email"]}, "lost_reasons": ["Muito longe", "Comprou em outra loja", "Desistiu da compra", "Sem crédito", "Longe demais", "Só pesquisando", "Preço"], "reabertura": "mesmo_registro", "won_reason_required": false, "won_reasons": []}, "slug": "loja-72h"}]}$modelo$::jsonb;
  v_nomes jsonb := public.fn_iavek_nomes_do_funil_de_loja();
  v_settings jsonb;
  v_tem_funil uuid;
  v_mapa jsonb := '{}'::jsonb;
  v_funil jsonb;
  v_etapa jsonb;
  v_fid uuid;
  v_eid uuid;
  v_esteira jsonb;
begin
  -- (Lupa 193007 1) dois pedidos juntos para a mesma org: um espera o outro, e o 2º vê o que o 1º fez
  perform pg_advisory_xact_lock(hashtextextended('iavek_funil_loja:' || p_org::text, 0));
  select settings into v_settings from public.organizations where id = p_org for update;
  if not found then raise exception 'organização não encontrada'; end if;
  select id into v_tem_funil from public.crm_pipelines where organization_id = p_org and slug = 'loja-72h';
  -- (Lupa 193007 2) os estados do meio: nada é escrito
  if v_settings ? 'esteira' then
    return jsonb_build_object('resultado', 'ja_tinha', 'funil_72h', v_tem_funil);
  end if;
  if v_tem_funil is not null then
    return jsonb_build_object('resultado', 'tem_funil_sem_esteira', 'funil_72h', v_tem_funil);
  end if;
  if exists (select 1 from public.crm_pipelines where organization_id = p_org and slug = 'loja-follow-up') then
    return jsonb_build_object('resultado', 'tem_funil_sem_esteira');
  end if;

  -- os funis e as etapas, e o mapa '@...' -> id novo
  if exists (select 1 from jsonb_array_elements(v_modelo->'funis') f where (f->>'is_default')::boolean) then
    update public.crm_pipelines set is_default = false where organization_id = p_org and is_default;
  end if;
  for v_funil in select value from jsonb_array_elements(v_modelo->'funis') loop
    insert into public.crm_pipelines (organization_id, name, slug, is_default, position)
    values (p_org, coalesce(v_nomes->>(v_funil->>'slug'), v_funil->>'slug'), v_funil->>'slug',
            coalesce((v_funil->>'is_default')::boolean, false), (v_funil->>'position')::numeric)
    returning id into v_fid;
    v_mapa := v_mapa || jsonb_build_object('@funil:' || (v_funil->>'slug'), v_fid);
    for v_etapa in select value from jsonb_array_elements(v_funil->'etapas') loop
      insert into public.crm_stages (organization_id, pipeline_id, name, slug, description, position, color, is_won, is_lost,
                                     is_archived, expected_duration_hours, requires_human, agent_stage_hint, win_probability,
                                     avisar_na_central, is_compra_futura)
      values (p_org, v_fid, v_etapa->>'name', v_etapa->>'slug', v_etapa->>'description', (v_etapa->>'position')::numeric,
              v_etapa->>'color', coalesce((v_etapa->>'is_won')::boolean, false), coalesce((v_etapa->>'is_lost')::boolean, false),
              coalesce((v_etapa->>'is_archived')::boolean, false), (v_etapa->>'expected_duration_hours')::numeric,
              coalesce((v_etapa->>'requires_human')::boolean, false), v_etapa->>'agent_stage_hint',
              (v_etapa->>'win_probability')::numeric, coalesce((v_etapa->>'avisar_na_central')::boolean, false),
              coalesce((v_etapa->>'is_compra_futura')::boolean, false))
      returning id into v_eid;
      v_mapa := v_mapa || jsonb_build_object('@etapa:' || (v_funil->>'slug') || ':' || (v_etapa->>'slug'), v_eid);
    end loop;
  end loop;

  -- o settings de cada funil, com as referências trocadas pelos ids novos (falha alto se faltar uma)
  for v_funil in select value from jsonb_array_elements(v_modelo->'funis') loop
    update public.crm_pipelines
       set settings = public.fn_iavek_resolver_modelo(coalesce(v_funil->'settings', '{}'::jsonb), v_mapa)
     where organization_id = p_org and slug = v_funil->>'slug';
  end loop;

  -- a esteira, DESLIGADA, a partir de agora (desde = agora: leads antigos não entram)
  v_esteira := public.fn_iavek_resolver_modelo(v_modelo->'esteira', v_mapa);
  v_esteira := jsonb_set(v_esteira || jsonb_build_object('ativa', false), '{entrada,desde}',
                         to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  update public.organizations set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('esteira', v_esteira)
   where id = p_org;

  return jsonb_build_object('resultado', 'criado', 'funil_72h', v_mapa->>'@funil:loja-72h',
                            'funil_follow_up', v_mapa->>'@funil:loja-follow-up', 'etapas', (select count(*) from jsonb_object_keys(v_mapa)) - 2);
end
$$;

-- (Lupa 193007 3) só o service_role
revoke execute on function public.fn_iavek_semear_funil_loja(uuid) from public, anon, authenticated;
grant execute on function public.fn_iavek_semear_funil_loja(uuid) to service_role;
revoke execute on function public.fn_iavek_resolver_modelo(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fn_iavek_resolver_modelo(jsonb, jsonb) to service_role;
revoke execute on function public.fn_iavek_nomes_do_funil_de_loja() from public, anon, authenticated;
grant execute on function public.fn_iavek_nomes_do_funil_de_loja() to service_role;
