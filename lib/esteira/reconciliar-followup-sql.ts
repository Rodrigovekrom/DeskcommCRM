/**
 * ia.vek v1.9.60.1 (Maestro 232512; medido na produção em 20/11, log medir-esteira-timeout c1ab098b): o SQL do passo 6
 * da rodada (`reconciliarFollowup`, deps-reais.ts). Desde 20/11 13:07Z ele estourava o tempo-limite (~120 s) em TODA
 * rodada da Fenômenos (média de 49,8 s em 1358 chamadas antes disso). O lento era a parte das TAREFAS ('t'): a
 * subconsulta `tk.lead_id in (select ... where x2.source_metadata->'movido_para'->>'lead_id' = k.id::text)` é
 * CORRELACIONADA com o clone (k), então o banco a refazia para CADA par tarefa x clone (151 clones x 1834 tarefas,
 * cada vez varrendo os ~1000 perdidos da org pelo jsonb). Com a estatística errada de `user_organizations` (o banco
 * estimava 2 clones), o plano virava um Nested Loop com essa subconsulta por par.
 *
 * A mudança é SÓ na 't', com o MESMO resultado: os originais de cada clone saem UMA vez ('origs', um hash join pelo
 * movido_para, o mesmo do 'o', que levava 7 ms na produção), juntam-se aos próprios clones ('alvos': lead -> clone) e
 * as tarefas entram por `lead_id` (índice crm_tasks_lead_idx). Os filtros são os mesmos de antes: org, não 'done',
 * com alguém, alguém que não é o dono do clone, e criada até a passagem (created_at <= clone). As outras partes ('g',
 * 'o') e o retorno (guardioes, originais, tarefas) não mudam. O teste
 * tests/invariants/iavek-v19601-reconciliar-followup-igual.test.ts roda o SQL ANTIGO e este no mesmo banco e compara.
 *
 * v1.9.62 (CRM-497): só para os clones de antes do cartão único (`esteira_passou_em is null`).
 *
 * $1 = organization_id, $2 = pipeline_id do Follow-up.
 */
export const SQL_RECONCILIAR_FOLLOWUP = `with sdrs as (
           select user_id from public.user_organizations
            where organization_id = $1 and revoked_at is null and role = 'agent' and interface_settings->>'funcao' = 'sdr_followup'),
         clones as (
           select c.id, c.owner_user_id, c.created_at from public.crm_leads c
            where c.organization_id = $1 and c.pipeline_id = $2 and c.owner_user_id in (select user_id from sdrs)
              and c.created_at > now() - interval '30 days'
              -- (v1.9.62, CRM-497) SÓ os CLONES de antes da 62: o lead que passou pelo move (esteira_passou_em) já
              -- levou o dono e o guardião na mesma escrita, e as tarefas dele NÃO são reatribuídas (D4 do Rodrigo)
              and c.esteira_passou_em is null),
         g as (
           update public.crm_leads c set sdr_user_id = c.owner_user_id
             from clones k where c.id = k.id and c.sdr_user_id is distinct from c.owner_user_id returning c.id),
         o as (
           update public.crm_leads x set owner_user_id = k.owner_user_id, owner_kind = 'user', owner_agent_id = null, sdr_user_id = k.owner_user_id
             from clones k
            where x.organization_id = $1 and x.status = 'lost' and x.lost_reason = 'moved_to_another_pipeline'
              and x.source_metadata->'movido_para'->>'lead_id' = k.id::text
              and (x.owner_user_id is distinct from k.owner_user_id or x.sdr_user_id is distinct from k.owner_user_id)
           returning x.id),
         -- (v1.9.60.1) os ORIGINAIS de cada clone, uma vez só (antes: uma subconsulta por par tarefa x clone)
         origs as (
           select x2.id as lead_id, k.id as clone_id from public.crm_leads x2
             join clones k on x2.source_metadata->'movido_para'->>'lead_id' = k.id::text
            where x2.organization_id = $1 and x2.status = 'lost' and x2.lost_reason = 'moved_to_another_pipeline'),
         -- os 2 leads de cada passagem: o próprio clone e o original dele
         alvos as (
           select k.id as lead_id, k.id as clone_id from clones k
           union
           select lead_id, clone_id from origs),
         -- (Lupa 050818, Maestro 050832) as TAREFAS dos 2 leads (o clone e o original) com outra pessoa, menos as 'done':
         -- é a tarefa que abre o contato a quem a tem (fn_iavek_contatos_do_vendedor), então uma falha no passo (d) da
         -- passagem não pode ficar calada.
         t as (
           update public.crm_tasks tk set assigned_to = k.owner_user_id
             from alvos a join clones k on k.id = a.clone_id
            where tk.lead_id = a.lead_id
              and tk.organization_id = $1 and tk.status <> 'done'
              and tk.assigned_to is not null and tk.assigned_to is distinct from k.owner_user_id
              -- (Lupa 051624, Maestro 051636) SÓ as tarefas que JÁ EXISTIAM na passagem (o clone nasce nela). A tarefa
              -- criada DEPOIS é de quem a pessoa quis (o SDR de Follow-up ou o gerente pode DELEGAR a um vendedor).
              and tk.created_at <= k.created_at
           returning tk.id)
         select (select count(*) from g)::int as guardioes, (select count(*) from o)::int as originais,
                (select count(*) from t)::int as tarefas`;

/**
 * ia.vek v1.9.62 (CRM-497, Lupa 202834): a VARREDURA idempotente das tarefas da passagem. A passagem das 72h move o lead
 * numa escrita e fecha as tarefas numa 2ª chamada (fn_iavek_tarefas_da_passagem); se a 2ª falhar, o lead já passou e as
 * tarefas de ANTES da passagem ficariam abertas (só a linha de log contava). A cada rodada, no Follow-up: os leads ABERTOS
 * que passaram pelo move (esteira_passou_em, nos últimos 30 dias) e ainda têm tarefa aberta CRIADA ANTES da passagem: as
 * automáticas fecham com 'passou_ao_followup' e as de pessoa com 'passagem_sem_revisao' (as preservadas, $3, ficam: P3),
 * cada uma com a linha task_cancelled. A tarefa criada DEPOIS da passagem nunca é tocada. Devolve quantas fechou.
 * $1 = organization_id, $2 = pipeline_id do Follow-up, $3 = text[] dos source_kind preservados.
 */
export const SQL_VARRER_TAREFAS_DA_PASSAGEM = `with alvo as (
           select l.id, l.esteira_passou_em from public.crm_leads l
            where l.organization_id = $1 and l.pipeline_id = $2 and l.status = 'open'
              and l.esteira_passou_em is not null and l.esteira_passou_em > now() - interval '30 days'),
         canceladas as (
           update public.crm_tasks t
              set status = 'cancelled',
                  cancelada_motivo = case when coalesce(t.source_kind = any(array['ligacao:L1','ligacao:L2','ligacao:L3','ligacao:L4','ligacao:L5','ligacao:L6','ligacao:L7','ligacao:quente']), false)
                                          then 'passou_ao_followup' else 'passagem_sem_revisao' end
             from alvo a
            where t.organization_id = $1 and t.lead_id = a.id
              and t.status in ('pending', 'in_progress')
              and t.created_at < a.esteira_passou_em
              and not coalesce(t.source_kind = any($3::text[]), false)
           returning t.id, t.organization_id, t.lead_id, t.contact_id, t.title, t.source_kind, t.cancelada_motivo),
         log as (
           insert into public.crm_lead_activities
             (organization_id, lead_id, contact_id, source_module, source_id, type, actor_kind, reason, payload, metadata, performed_at)
           select c.organization_id, c.lead_id, c.contact_id, 'tarefas', c.id, 'task_cancelled', 'rule',
                  'Tarefa cancelada na passagem (varredura): ' || c.cancelada_motivo,
                  jsonb_build_object('motivo', c.cancelada_motivo, 'ligacao', c.source_kind, 'titulo', left(c.title, 200)),
                  jsonb_build_object('origem', 'varredura_da_passagem'), now()
             from canceladas c)
         select count(*)::int as varridas from canceladas`;
